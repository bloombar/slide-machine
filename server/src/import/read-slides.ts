/**
 * Reading a Google Slides presentation into the shape everything downstream
 * uses (TMPL-8, docs/TEMPLATES.md §6 stage 1).
 *
 * The only stage that touches Google. Everything it produces is
 * provider-neutral, so the passes that derive a design from it never learn
 * what an EMU is.
 *
 * ## Why the Slides API and not the file
 *
 * Drive can export a presentation as .pptx, which would mean parsing OOXML.
 * The Slides API hands back the same information already structured — shapes,
 * placeholder types, text runs with resolved styles, the master's colour
 * scheme — and its read methods accept the `drive.readonly` scope this app
 * already asks for. Nobody should have to reconnect to import a design; if a
 * stored authorization really does turn out to lack it, the caller is told to
 * reconnect rather than shown an error it cannot act on.
 */
import {
  type SourceBox,
  type SourceElement,
  type SourcePage,
  type SourcePresentation,
  type SourceRun,
  type SourceTheme,
} from './source-presentation'
import { parseSlotMetadata, slotFromToken } from '../lib/slot-metadata'

/** Raised when the connected account cannot read this presentation, so the
 * caller can say what to do about it rather than showing a status code. */
export class PresentationUnreadableError extends Error {
  constructor(
    message: string,
    /** Whether reconnecting the Google account would plausibly fix it. */
    readonly reconnect = false,
  ) {
    super(message)
    this.name = 'PresentationUnreadableError'
  }
}

/** Google measures everything in EMU; 914400 to the inch. */
const EMU = 914400

/** A default page, for a presentation that somehow states no size. 16:9 at
 * ten inches, which is what every deck this app makes is. */
const DEFAULT_PAGE = { width: 10 * EMU, height: 5.625 * EMU }

interface Dimension {
  magnitude?: number
  unit?: string
}

const emu = (d: Dimension | undefined): number => {
  if (!d?.magnitude) return 0
  return d.unit === 'PT' ? d.magnitude * (EMU / 72) : d.magnitude
}

/**
 * Where a shape sits, as a fraction of the page.
 *
 * Google gives a size and an affine transform rather than a rectangle: the
 * size is the shape's own, and the transform scales and moves it. Multiplying
 * the two is what turns them into the box you actually see.
 */
const boxOf = (
  element: Record<string, unknown>,
  page: { width: number; height: number },
): SourceBox => {
  const size = element.size as
    { width?: Dimension; height?: Dimension } | undefined
  const t = (element.transform ?? {}) as {
    scaleX?: number
    scaleY?: number
    translateX?: Dimension
    translateY?: Dimension
  }
  const w = emu(size?.width) * (t.scaleX ?? 1)
  const h = emu(size?.height) * (t.scaleY ?? 1)
  const x = emu(t.translateX)
  const y = emu(t.translateY)
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return {
    x: clamp(x / page.width),
    y: clamp(y / page.height),
    w: clamp(w / page.width),
    h: clamp(h / page.height),
  }
}

/** `{red,green,blue}` 0–1 as `#rrggbb`. */
const rgbHex = (
  rgb: Record<string, number> | undefined,
): string | undefined => {
  if (!rgb) return undefined
  const byte = (v: number | undefined) =>
    Math.round(Math.min(1, Math.max(0, v ?? 0)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(rgb.red)}${byte(rgb.green)}${byte(rgb.blue)}`
}

/**
 * A colour, resolved through the master's scheme.
 *
 * A presentation refers to its palette by name — `DARK1`, `ACCENT1` — and
 * those names mean nothing once the design leaves it, so they are looked up
 * here and only literals travel on.
 */
const colorOf = (
  color: Record<string, unknown> | undefined,
  scheme: Record<string, string>,
): string | undefined => {
  if (!color) return undefined
  // Google wraps the colour differently depending on where it sits: text
  // styles nest it under `opaqueColor`, fills under `color`. Same colour,
  // two envelopes.
  const opaque = (color.opaqueColor ?? color.color ?? color) as Record<
    string,
    unknown
  >
  const themed = opaque.themeColor as string | undefined
  if (themed) return scheme[themed]
  return rgbHex(opaque.rgbColor as Record<string, number> | undefined)
}

/** The master's colour scheme, by name. */
const schemeOf = (
  masters: Record<string, unknown>[],
): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const master of masters) {
    const properties = master.pageProperties as
      | {
          colorScheme?: {
            colors?: { type?: string; color?: Record<string, number> }[]
          }
        }
      | undefined
    for (const entry of properties?.colorScheme?.colors ?? []) {
      const hex = rgbHex(entry.color)
      if (entry.type && hex && !out[entry.type]) out[entry.type] = hex
    }
  }
  return out
}

/** The type size in `cqi` — a percent of the page width, which is what the
 * template model measures type in. */
const fontSizeCqi = (
  size: Dimension | undefined,
  pageWidth: number,
): number | undefined => {
  const points = size?.magnitude
  if (!points) return undefined
  return Math.round(((points * (EMU / 72)) / pageWidth) * 100 * 100) / 100
}

/** The runs of one text element, with the styling worth keeping. */
const runsOf = (
  text: Record<string, unknown> | undefined,
  scheme: Record<string, string>,
  pageWidth: number,
): { runs: SourceRun[]; bulleted: boolean } => {
  const elements = (text?.textElements ?? []) as Record<string, unknown>[]
  const runs: SourceRun[] = []
  let bulleted = false
  for (const element of elements) {
    if (element.paragraphMarker) {
      const marker = element.paragraphMarker as { bullet?: unknown }
      if (marker.bullet) bulleted = true
      continue
    }
    const run = element.textRun as
      { content?: string; style?: Record<string, unknown> } | undefined
    if (!run?.content) continue
    const content = run.content.replace(/\n$/, '')
    if (!content) continue
    const style = run.style ?? {}
    runs.push({
      text: content,
      fontSize: fontSizeCqi(style.fontSize as Dimension, pageWidth),
      bold: style.bold === true ? true : undefined,
      italic: style.italic === true ? true : undefined,
      color: colorOf(style.foregroundColor as Record<string, unknown>, scheme),
      fontFamily: (style.fontFamily as string) || undefined,
    })
  }
  return { runs, bulleted }
}

/** Cells of a table, as text. */
const tableOf = (table: Record<string, unknown>): string[][] =>
  ((table.tableRows ?? []) as Record<string, unknown>[]).map(row =>
    ((row.tableCells ?? []) as Record<string, unknown>[]).map(cell => {
      const { runs } = runsOf(
        cell.text as Record<string, unknown>,
        {},
        DEFAULT_PAGE.width,
      )
      return runs.map(r => r.text).join('')
    }),
  )

/** One shape, whatever it turned out to be. */
const elementOf = (
  raw: Record<string, unknown>,
  page: { width: number; height: number },
  scheme: Record<string, string>,
): SourceElement | null => {
  const id = (raw.objectId as string) ?? ''
  const box = boxOf(raw, page)
  // Alt text is where this system writes what a box IS (EXP-8), and it is
  // worth more than anything inferred below.
  const slotName = slotFromToken(raw.description as string | undefined)

  const image = raw.image as { contentUrl?: string } | undefined
  if (image) {
    return {
      id,
      kind: 'image',
      box,
      ...(slotName ? { slotName } : {}),
      ...(image.contentUrl ? { imageUrl: image.contentUrl } : {}),
    }
  }

  const table = raw.table as Record<string, unknown> | undefined
  if (table) {
    return {
      id,
      kind: 'table',
      box,
      ...(slotName ? { slotName } : {}),
      table: { rows: tableOf(table) },
    }
  }

  const shape = raw.shape as
    | {
        shapeType?: string
        text?: Record<string, unknown>
        placeholder?: { type?: string }
        shapeProperties?: {
          shapeBackgroundFill?: { solidFill?: Record<string, unknown> }
        }
      }
    | undefined
  if (!shape) return null

  const placeholder = shape.placeholder?.type
  const { runs, bulleted } = runsOf(shape.text, scheme, page.width)
  if (!runs.length) {
    // No words: a rule, a band, or an empty placeholder. Only the ones that
    // paint something are worth carrying — an empty box is not a design.
    const fill = colorOf(
      shape.shapeProperties?.shapeBackgroundFill?.solidFill,
      scheme,
    )
    if (!fill && !placeholder) return null
    return {
      id,
      kind: placeholder ? 'text' : 'decoration',
      box,
      ...(placeholder ? { placeholder } : {}),
      ...(slotName ? { slotName } : {}),
      ...(fill ? { fill } : {}),
    }
  }

  return {
    id,
    kind: 'text',
    box,
    ...(placeholder ? { placeholder } : {}),
    ...(slotName ? { slotName } : {}),
    runs,
    ...(bulleted ? { bulleted: true } : {}),
  }
}

/** The slot metadata this system wrote onto a page, if it wrote any (EXP-8). */
const metadataOf = (
  elements: Record<string, unknown>[],
): Record<string, unknown>[] | undefined => {
  for (const raw of elements) {
    const parsed = parseSlotMetadata(raw.description as string | undefined)
    if (parsed) return parsed as unknown as Record<string, unknown>[]
  }
  return undefined
}

/** The speaker notes of a slide, which carry its narration (EXP-8). */
const notesOf = (slide: Record<string, unknown>): string | undefined => {
  const notes = (
    slide.slideProperties as { notesPage?: Record<string, unknown> }
  )?.notesPage
  const elements = (notes?.pageElements ?? []) as Record<string, unknown>[]
  const said = elements
    .map(el => {
      const shape = el.shape as
        | { placeholder?: { type?: string }; text?: Record<string, unknown> }
        | undefined
      if (shape?.placeholder?.type !== 'BODY') return ''
      return runsOf(shape.text, {}, DEFAULT_PAGE.width)
        .runs.map(r => r.text)
        .join('')
    })
    .join('\n')
    .trim()
  return said || undefined
}

const pageOf = (
  raw: Record<string, unknown>,
  page: { width: number; height: number },
  scheme: Record<string, string>,
): SourcePage => {
  const rawElements = (raw.pageElements ?? []) as Record<string, unknown>[]
  const properties = raw.pageProperties as
    | {
        pageBackgroundFill?: {
          solidFill?: Record<string, unknown>
          stretchedPictureFill?: { contentUrl?: string }
        }
      }
    | undefined
  // A page is filled with a colour OR a picture; the picture is part of the
  // design just as much as the colour is, and dropping it would import a deck
  // that looks nothing like the one it came from.
  const backgroundImage =
    properties?.pageBackgroundFill?.stretchedPictureFill?.contentUrl
  const metadata = metadataOf(rawElements)
  const notes = notesOf(raw)
  return {
    id: (raw.objectId as string) ?? '',
    name:
      ((raw.layoutProperties as { displayName?: string })?.displayName ||
        undefined) ??
      undefined,
    layoutId:
      ((raw.slideProperties as { layoutObjectId?: string })?.layoutObjectId ||
        undefined) ??
      undefined,
    background: colorOf(properties?.pageBackgroundFill?.solidFill, scheme),
    ...(backgroundImage ? { backgroundImage } : {}),
    elements: rawElements
      .map(el => elementOf(el, page, scheme))
      .filter((el): el is SourceElement => el !== null),
    ...(metadata ? { slotMetadata: metadata } : {}),
    ...(notes ? { notes } : {}),
  }
}

/** The palette a design is drawn in, from the master's scheme with sane
 * fallbacks — a presentation missing a name should look like a default rather
 * than like a bug. */
const themeOf = (
  scheme: Record<string, string>,
  firstSlideBackground: string | undefined,
): SourceTheme => ({
  background: firstSlideBackground ?? scheme.LIGHT1 ?? '#ffffff',
  text: scheme.DARK1 ?? '#1c2230',
  accent: scheme.ACCENT1 ?? '#4a54d1',
  muted: scheme.DARK2 ?? scheme.ACCENT2 ?? '#6b7280',
})

/** Turns one Slides API response into the shape everything downstream reads. */
export const toSourcePresentation = (
  raw: Record<string, unknown>,
): SourcePresentation => {
  const size = raw.pageSize as
    { width?: Dimension; height?: Dimension } | undefined
  const page = {
    width: emu(size?.width) || DEFAULT_PAGE.width,
    height: emu(size?.height) || DEFAULT_PAGE.height,
  }
  const scheme = schemeOf((raw.masters ?? []) as Record<string, unknown>[])
  const layouts = ((raw.layouts ?? []) as Record<string, unknown>[]).map(l =>
    pageOf(l, page, scheme),
  )
  const slides = ((raw.slides ?? []) as Record<string, unknown>[]).map(s =>
    pageOf(s, page, scheme),
  )
  return {
    id: (raw.presentationId as string) ?? '',
    title: (raw.title as string) || 'Imported design',
    theme: themeOf(scheme, slides[0]?.background),
    layouts,
    slides,
  }
}

/**
 * Reads a presentation from Google.
 *
 * A 403 is reported as something the user can act on: their stored
 * authorization may predate the access this needs, and reconnecting is the
 * fix. Anything else is a failure to read, said plainly.
 */
export const readPresentationLive = async (
  accessToken: string,
  presentationId: string,
): Promise<SourcePresentation> => {
  const res = await fetch(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (res.status === 403 || res.status === 401) {
    throw new PresentationUnreadableError(
      'Google would not let this account read that presentation',
      true,
    )
  }
  if (res.status === 404) {
    throw new PresentationUnreadableError('That presentation was not found')
  }
  if (!res.ok) {
    throw new PresentationUnreadableError(
      `Google Slides read failed (${res.status})`,
    )
  }
  return toSourcePresentation((await res.json()) as Record<string, unknown>)
}
