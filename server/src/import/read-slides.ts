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

/**
 * How far a chain of inheritance is followed.
 *
 * Slide → layout → master is three, and a presentation should never offer a
 * fourth. The bound is what stops a file whose ids point in a circle from
 * hanging the import.
 */
const MAX_INHERITANCE = 4

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
 * What a page and a shape can inherit from (TMPL-8).
 *
 * Google states a property once and lets everything below it go unset. A
 * slide's title placeholder usually carries no size, no transform and no type
 * size at all — those live on the layout's placeholder, or the master's. Read
 * without following that, the deck arrives with its boxes collapsed into the
 * corner and its colours gone, which is exactly what it did.
 *
 * So both chains are indexed up front: pages by id, so a slide can find its
 * layout and a layout its master, and every element of a layout or master by
 * id, so a placeholder can find the one it descends from.
 */
interface Ancestry {
  /** Layout and master pages, by object id. */
  pages: Map<string, Record<string, unknown>>
  /** Every element that can be inherited from, by object id. */
  elements: Map<string, Record<string, unknown>>
}

const indexAncestry = (
  layouts: Record<string, unknown>[],
  masters: Record<string, unknown>[],
): Ancestry => {
  const pages = new Map<string, Record<string, unknown>>()
  const elements = new Map<string, Record<string, unknown>>()
  for (const page of [...layouts, ...masters]) {
    const id = page.objectId as string | undefined
    if (id) pages.set(id, page)
    for (const el of (page.pageElements ?? []) as Record<string, unknown>[]) {
      const elementId = el.objectId as string | undefined
      if (elementId) elements.set(elementId, el)
    }
  }
  return { pages, elements }
}

/**
 * A shape and the placeholders it descends from, nearest first.
 *
 * Google names the link `parentObjectId` on the placeholder itself, which is
 * the reliable one: matching by placeholder type and index guesses, and gets
 * it wrong on a layout with two body boxes.
 */
const shapeChain = (
  raw: Record<string, unknown>,
  ancestry: Ancestry,
): Record<string, unknown>[] => {
  const chain = [raw]
  const seen = new Set<string>([(raw.objectId as string) ?? ''])
  let current = raw
  for (let depth = 0; depth < MAX_INHERITANCE; depth++) {
    const parentId = (
      current.shape as { placeholder?: { parentObjectId?: string } } | undefined
    )?.placeholder?.parentObjectId
    if (!parentId || seen.has(parentId)) break
    const parent = ancestry.elements.get(parentId)
    if (!parent) break
    seen.add(parentId)
    chain.push(parent)
    current = parent
  }
  return chain
}

/** A page and the pages it is built on: slide → layout → master. */
const pageChain = (
  raw: Record<string, unknown>,
  ancestry: Ancestry,
): Record<string, unknown>[] => {
  const chain = [raw]
  const seen = new Set<string>([(raw.objectId as string) ?? ''])
  let current = raw
  for (let depth = 0; depth < MAX_INHERITANCE; depth++) {
    // A slide names both the layout it is built on and the master behind
    // that. The layout comes first because it is the nearer answer, but the
    // master is followed when the layout is missing — a deck whose layout
    // reference does not resolve still has a design, and stopping there is
    // how it lost its colours.
    const slide = current.slideProperties as
      { layoutObjectId?: string; masterObjectId?: string } | undefined
    const candidates = [
      slide?.layoutObjectId,
      slide?.masterObjectId,
      (current.layoutProperties as { masterObjectId?: string } | undefined)
        ?.masterObjectId,
    ]
    const parentId = candidates.find(
      id => id && !seen.has(id) && ancestry.pages.has(id),
    )
    if (!parentId) break
    seen.add(parentId)
    const parent = ancestry.pages.get(parentId)!
    chain.push(parent)
    current = parent
  }
  return chain
}

/**
 * A transform's translation.
 *
 * Google states these two DIFFERENTLY from every other measurement in the
 * response. A size is a `Dimension` — `{magnitude, unit}` — but an
 * `AffineTransform` carries bare numbers with a single `unit` on the transform
 * itself. Read as a Dimension, `translateX` has no `magnitude`, comes back
 * zero, and every shape in the presentation lands at the top-left corner with
 * its size intact. That is exactly what an imported design did: boxes the
 * right shape, all stacked in the corner.
 *
 * Both forms are accepted, because a caller that already has a Dimension
 * should not have to know which of Google's two conventions applies here.
 */
const translation = (
  value: number | Dimension | undefined,
  unit: string | undefined,
): number => {
  if (typeof value === 'number') {
    return unit === 'PT' ? value * (EMU / 72) : value
  }
  return emu(value)
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
    translateX?: number | Dimension
    translateY?: number | Dimension
    unit?: string
  }
  const w = emu(size?.width) * (t.scaleX ?? 1)
  const h = emu(size?.height) * (t.scaleY ?? 1)
  const x = translation(t.translateX, t.unit)
  const y = translation(t.translateY, t.unit)
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return {
    x: clamp(x / page.width),
    y: clamp(y / page.height),
    w: clamp(w / page.width),
    h: clamp(h / page.height),
  }
}

/**
 * The box a shape actually occupies, taking the first one in its chain that
 * states a size.
 *
 * A placeholder that leaves its geometry unset is not a shape at the origin
 * with no width — it is a shape drawn where its layout says. Reading the
 * absent size as zero is what collapsed an imported design into the corner.
 */
const boxFromChain = (
  chain: Record<string, unknown>[],
  page: { width: number; height: number },
): SourceBox | undefined => {
  for (const element of chain) {
    const box = boxOf(element, page)
    if (box.w > 0 && box.h > 0) return box
  }
  // Nothing anywhere in the chain says where this shape goes or how big it
  // is. That is not a shape at the origin with no area — it is not a shape
  // on the page at all, and every one of them placed there would sit in the
  // same spot, printing over each other in the corner.
  return undefined
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

/** The first run style a shape states, which is where a placeholder keeps the
 * type its slides are meant to be set in. */
const firstRunStyle = (
  raw: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const elements = ((raw.shape as { text?: Record<string, unknown> })?.text
    ?.textElements ?? []) as Record<string, unknown>[]
  for (const element of elements) {
    const style = (element.textRun as { style?: Record<string, unknown> })
      ?.style
    if (style && Object.keys(style).length) return style
  }
  return undefined
}

/**
 * The styling a shape inherits: the nearest ancestor to state each property.
 *
 * Only the styling. A layout's placeholder also holds prompt text — "Click to
 * edit Master title style" — and pulling that down would put Google's
 * instructions on the lecturer's slides.
 */
const inheritedStyle = (
  chain: Record<string, unknown>[],
  scheme: Record<string, string>,
  pageWidth: number,
): Omit<SourceRun, 'text'> => {
  const out: Omit<SourceRun, 'text'> = {}
  for (const raw of chain.slice(1)) {
    const style = firstRunStyle(raw)
    if (!style) continue
    out.fontSize ??= fontSizeCqi(style.fontSize as Dimension, pageWidth)
    out.color ??= colorOf(
      style.foregroundColor as Record<string, unknown>,
      scheme,
    )
    out.fontFamily ??= (style.fontFamily as string) || undefined
    if (out.bold === undefined && style.bold === true) out.bold = true
    if (out.italic === undefined && style.italic === true) out.italic = true
  }
  return out
}

/** The runs of one text element, with the styling worth keeping. Anything the
 * run leaves unset comes from the placeholder it descends from. */
const runsOf = (
  text: Record<string, unknown> | undefined,
  scheme: Record<string, string>,
  pageWidth: number,
  inherited: Omit<SourceRun, 'text'> = {},
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
    // A run's own value wins. An explicit `false` is a decision too — a run
    // that says it is not bold does not then inherit bold from its layout.
    runs.push({
      text: content,
      fontSize:
        fontSizeCqi(style.fontSize as Dimension, pageWidth) ??
        inherited.fontSize,
      bold:
        style.bold === true
          ? true
          : style.bold === false
            ? undefined
            : inherited.bold,
      italic:
        style.italic === true
          ? true
          : style.italic === false
            ? undefined
            : inherited.italic,
      color:
        colorOf(style.foregroundColor as Record<string, unknown>, scheme) ??
        inherited.color,
      fontFamily: (style.fontFamily as string) || inherited.fontFamily,
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

/** One shape, whatever it turned out to be. Anything it leaves unset comes
 * from the placeholder it descends from, on its layout or the master. */
const elementOf = (
  raw: Record<string, unknown>,
  page: { width: number; height: number },
  scheme: Record<string, string>,
  ancestry: Ancestry,
): SourceElement | null => {
  const id = (raw.objectId as string) ?? ''
  const chain = shapeChain(raw, ancestry)
  const box = boxFromChain(chain, page)
  // A shape with no place on the page cannot be drawn and cannot be part of
  // a design. Google returns these for a placeholder that was never given a
  // size anywhere in its chain — an empty box the author never filled in.
  if (!box) return null
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
          contentAlignment?: string
        }
      }
    | undefined
  if (!shape) return null

  // A slide's placeholder usually names its own type; where it does not, the
  // one it descends from does.
  const placeholder =
    shape.placeholder?.type ??
    chain
      .map(
        el =>
          (el.shape as { placeholder?: { type?: string } } | undefined)
            ?.placeholder?.type,
      )
      .find(Boolean)
  const { runs, bulleted } = runsOf(
    shape.text,
    scheme,
    page.width,
    inheritedStyle(chain, scheme, page.width),
  )
  // Google states alignment on the paragraph and the box separately, and
  // names them differently; both are part of how the slide looks.
  const ACROSS: Record<string, 'start' | 'center' | 'end'> = {
    START: 'start',
    CENTER: 'center',
    END: 'end',
    JUSTIFIED: 'start',
  }
  const DOWN: Record<string, 'start' | 'center' | 'end'> = {
    TOP: 'start',
    MIDDLE: 'center',
    BOTTOM: 'end',
  }
  // Alignment inherits the same way everything else does: a centred title on
  // the layout stays centred on every slide built from it, even though no
  // slide says so.
  const paragraphs = chain.flatMap(el =>
    (
      ((el.shape as { text?: { textElements?: unknown[] } } | undefined)?.text
        ?.textElements ?? []) as Record<string, unknown>[]
    ).map(
      p =>
        (p.paragraphMarker as { style?: { alignment?: string } } | undefined)
          ?.style?.alignment,
    ),
  )
  const align = ACROSS[paragraphs.find(Boolean) ?? '']
  const vAlign =
    DOWN[
      chain
        .map(
          el =>
            (
              el.shape as
                { shapeProperties?: { contentAlignment?: string } } | undefined
            )?.shapeProperties?.contentAlignment,
        )
        .find(Boolean) ?? ''
    ]
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
      // What the shape is, so an arrow is not drawn as a rectangle.
      ...(shape.shapeType ? { shapeType: shape.shapeType } : {}),
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
    ...(align ? { align } : {}),
    ...(vAlign ? { vAlign } : {}),
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

interface BackgroundFill {
  propertyState?: string
  solidFill?: Record<string, unknown>
  stretchedPictureFill?: { contentUrl?: string }
}

const fillOf = (raw: Record<string, unknown>): BackgroundFill | undefined =>
  (raw.pageProperties as { pageBackgroundFill?: BackgroundFill } | undefined)
    ?.pageBackgroundFill

/**
 * What a page is painted with, taking the first page in its chain to state it.
 *
 * A slide almost never states its own background — the colour belongs to the
 * layout, or to the master behind it. Reading only the slide is why a deck
 * built in deep blue arrived white.
 *
 * A page filled with a colour OR a picture is one decision, so the first page
 * to state either one settles both: a slide that overrides the colour is not
 * also still showing its master's photograph.
 */
const backgroundOf = (
  chain: Record<string, unknown>[],
  scheme: Record<string, string>,
): { background?: string; backgroundImage?: string } => {
  for (const raw of chain) {
    const fill = fillOf(raw)
    // Both of these mean "what you see here comes from further up": INHERIT
    // says so outright, and a fill that renders nothing shows the parent
    // through. Either way the answer is not on this page.
    if (fill?.propertyState === 'INHERIT') continue
    if (fill?.propertyState === 'NOT_RENDERED') continue
    const background = colorOf(fill?.solidFill, scheme)
    const backgroundImage = fill?.stretchedPictureFill?.contentUrl
    if (background || backgroundImage) return { background, backgroundImage }
  }
  // Nothing in the chain claimed one outright. Google sometimes returns the
  // resolved value beside an INHERIT marker, and that colour is still the
  // right answer — better than defaulting the deck to white.
  for (const raw of chain) {
    const fill = fillOf(raw)
    const background = colorOf(fill?.solidFill, scheme)
    const backgroundImage = fill?.stretchedPictureFill?.contentUrl
    if (background || backgroundImage) return { background, backgroundImage }
  }
  return {}
}

const pageOf = (
  raw: Record<string, unknown>,
  page: { width: number; height: number },
  scheme: Record<string, string>,
  ancestry: Ancestry,
): SourcePage => {
  const rawElements = (raw.pageElements ?? []) as Record<string, unknown>[]
  const { background, backgroundImage } = backgroundOf(
    pageChain(raw, ancestry),
    scheme,
  )
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
    background,
    ...(backgroundImage ? { backgroundImage } : {}),
    elements: rawElements
      .map(el => elementOf(el, page, scheme, ancestry))
      .filter((el): el is SourceElement => el !== null),
    ...(metadata ? { slotMetadata: metadata } : {}),
    ...(notes ? { notes } : {}),
  }
}

/** Relative luminance of `#rrggbb`, for deciding what reads against what. */
const luminance = (hex: string): number => {
  const channel = (from: number): number => {
    const v = parseInt(hex.slice(from, from + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/** WCAG contrast ratio between two `#rrggbb` colours, 1 (none) to 21. */
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

const isHex = (value: string | undefined): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

/**
 * The colour the deck's words are actually set in.
 *
 * Weighted by how much text is in each colour, so the body copy decides and a
 * one-word accent does not. This is evidence rather than declaration: a
 * presentation's colour scheme says what `DARK1` stands for, not that the deck
 * writes in it — a deck on a dark background writes in `LIGHT1` and taking
 * `DARK1` gives near-black text on near-black, which is what an imported
 * design looked like.
 */
const dominantTextColor = (pages: SourcePage[]): string | undefined => {
  const weight = new Map<string, number>()
  for (const page of pages) {
    for (const element of page.elements) {
      for (const run of element.runs ?? []) {
        if (!isHex(run.color)) continue
        weight.set(run.color, (weight.get(run.color) ?? 0) + run.text.length)
      }
    }
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** Enough contrast to read at body size. Below this the design is unusable,
 * whatever the presentation said. */
const READABLE = 3

/**
 * The palette a design is drawn in.
 *
 * Backgrounds and accents come from the presentation's own scheme; the text
 * colour comes from the text, because that is the one the scheme is least
 * reliable about. Every choice is checked against the background before it is
 * kept — an imported design that cannot be read is not the design that was
 * imported, it is a bug wearing its colours.
 */
const themeOf = (
  scheme: Record<string, string>,
  background: string | undefined,
  pages: SourcePage[],
): SourceTheme => {
  const bg = background ?? scheme.LIGHT1 ?? '#ffffff'
  /** The first of these that can actually be read on this background. */
  const readable = (...candidates: (string | undefined)[]): string => {
    const hexes = candidates.filter(isHex)
    return (
      hexes.find(c => contrast(c, bg) >= READABLE) ??
      // Nothing offered works, so fall back to the one that always does.
      (luminance(bg) > 0.4 ? '#1c2230' : '#ffffff')
    )
  }
  const text = readable(dominantTextColor(pages), scheme.DARK1, scheme.LIGHT1)
  return {
    background: bg,
    text,
    accent: readable(scheme.ACCENT1, scheme.ACCENT2, text),
    // Muted is the quiet one, so it may sit closer to the background than the
    // body text — but it still has to be legible.
    muted: readable(scheme.DARK2, scheme.ACCENT2, text),
  }
}

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
  const rawMasters = (raw.masters ?? []) as Record<string, unknown>[]
  const rawLayouts = (raw.layouts ?? []) as Record<string, unknown>[]
  const scheme = schemeOf(rawMasters)
  // Indexed before anything is read, because a slide's boxes and colours are
  // mostly stated on the layout and master behind it, not on the slide.
  const ancestry = indexAncestry(rawLayouts, rawMasters)
  const layouts = rawLayouts.map(l => pageOf(l, page, scheme, ancestry))
  const slides = ((raw.slides ?? []) as Record<string, unknown>[]).map(s =>
    pageOf(s, page, scheme, ancestry),
  )
  return {
    id: (raw.presentationId as string) ?? '',
    title: (raw.title as string) || 'Imported design',
    // The palette is read from the deck itself, layouts included: a title
    // slide alone is a thin sample of what the design writes in.
    theme: themeOf(scheme, slides[0]?.background, [...slides, ...layouts]),
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
