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
import {
  parseSlotMetadata,
  parseThemeStyles,
  slotFromToken,
} from '../lib/slot-metadata'
import { creditFromToken, isCreditLine } from '../lib/image-attribution-token'
import { creditFromLine } from '../lib/image-credit'

/** Raised when the connected account cannot read this presentation, so the
 * caller can say what to do about it rather than showing a status code. */
export class PresentationUnreadableError extends Error {
  constructor(
    message: string,
    /** Whether reconnecting the Google account would plausibly fix it. */
    readonly reconnect = false,
    /**
     * Whether the presentation simply was not there.
     *
     * Kept apart from `reconnect` because the two ask the user for opposite
     * things — one to grant access, the other to check the link — and a
     * single "could not read it" would tell them to do neither.
     */
    readonly notFound = false,
    /**
     * Whether the account is fine and this deck is not theirs to open.
     *
     * The third case, and the common one: someone pastes a link to a
     * colleague's lecture. Nothing is wrong with the connection, so offering
     * to reconnect sends them through Google's consent screen to arrive back
     * at the same refusal. What they need is access to the deck, or an
     * account that already has it.
     */
    readonly forbidden = false,
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
    // Opened out, so a placeholder that happens to sit inside a group is still
    // findable by the slide that descends from it.
    for (const el of flattenGroups(
      (page.pageElements ?? []) as Record<string, unknown>[],
    )) {
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

/** Google's affine transform, in either of the two unit conventions it uses
 * for the translation (see `translation`). */
interface Affine {
  scaleX?: number
  scaleY?: number
  shearX?: number
  shearY?: number
  translateX?: number | Dimension
  translateY?: number | Dimension
  unit?: string
}

/**
 * One transform applied on top of another, in EMU.
 *
 * A grouped shape states its transform relative to the group it is in, so its
 * own is only half the answer — the group's has to be applied over it to get
 * where the shape actually sits. Ordinary 3×3 affine multiplication, written
 * out because only six of the nine entries ever vary.
 */
const concat = (parent: Affine, child: Affine): Affine => {
  const at = (t: Affine) => ({
    sx: t.scaleX ?? 1,
    sy: t.scaleY ?? 1,
    shx: t.shearX ?? 0,
    shy: t.shearY ?? 0,
    tx: translation(t.translateX, t.unit),
    ty: translation(t.translateY, t.unit),
  })
  const p = at(parent)
  const c = at(child)
  return {
    scaleX: p.sx * c.sx + p.shx * c.shy,
    shearX: p.sx * c.shx + p.shx * c.sy,
    translateX: p.sx * c.tx + p.shx * c.ty + p.tx,
    shearY: p.shy * c.sx + p.sy * c.shy,
    scaleY: p.shy * c.shx + p.sy * c.sy,
    translateY: p.shy * c.tx + p.sy * c.ty + p.ty,
    unit: 'EMU',
  }
}

/** How deep a nest of groups is followed. A group inside a group inside a
 * group is already unusual; the bound is what stops a malformed file from
 * recursing without end. */
const MAX_GROUP_DEPTH = 8

/**
 * A page's elements with every group opened out, each shape carrying the
 * transform it actually has on the page.
 *
 * Google returns a group as ONE element with its parts nested inside it, and
 * nothing here reads a group: it is neither an image, nor a table, nor a
 * shape, so it was skipped whole. A crest that is a mark beside a wordmark, or
 * a background pattern built from a dozen rules, is a group — which is why an
 * imported design could come back with none of it.
 *
 * The parts come out flat, because that is what a design is here: pieces at
 * absolute positions. Grouping is an authoring convenience with nothing to say
 * about how the page looks.
 */
const flattenGroups = (
  elements: Record<string, unknown>[],
  parent?: Affine,
  depth = 0,
): Record<string, unknown>[] =>
  elements.flatMap(raw => {
    const absolute = parent
      ? concat(parent, (raw.transform ?? {}) as Affine)
      : ((raw.transform ?? {}) as Affine)
    const group = raw.elementGroup as
      { children?: Record<string, unknown>[] } | undefined
    if (group) {
      if (depth >= MAX_GROUP_DEPTH) return []
      return flattenGroups(group.children ?? [], absolute, depth + 1)
    }
    return [parent ? { ...raw, transform: absolute } : raw]
  })

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
  const rgb = rgbHex(opaque.rgbColor as Record<string, number> | undefined)
  if (themed) {
    // A master lists its scheme under one set of names and text styles may
    // ask for the same colour under another: `TEXT1` and `DARK1` are one
    // entry, as are `BACKGROUND1` and `LIGHT1`. Looked up under the name
    // given and then under its other name, because a miss here is not an
    // error — it silently drops the colour, and the box falls back to the
    // deck's default ink. That is how a heading an author set in red came
    // back black.
    const alias: Record<string, string> = {
      TEXT1: 'DARK1',
      TEXT2: 'DARK2',
      BACKGROUND1: 'LIGHT1',
      BACKGROUND2: 'LIGHT2',
      DARK1: 'TEXT1',
      DARK2: 'TEXT2',
      LIGHT1: 'BACKGROUND1',
      LIGHT2: 'BACKGROUND2',
    }
    // The resolved value where Google sent one beside the name, as a last
    // resort: a colour we cannot name is still the colour the slide shows.
    return scheme[themed] ?? scheme[alias[themed] ?? ''] ?? rgb
  }
  return rgb
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
  /*
   * How each list in this box is drawn.
   *
   * A paragraph says which list it belongs to and how deep it sits; the list
   * says what its markers look like at that depth. Digits or letters make it
   * a numbered list, and reading it as bulleted turns "1. 2. 3." into three
   * dashes — an ordering the author meant.
   */
  const lists = (text?.lists ?? {}) as Record<
    string,
    { nestingLevel?: Record<string, { glyphType?: string }> }
  >
  /**
   * Whether a marker counts rather than merely marks.
   *
   * The marker Google actually renders — "1.", "a.", "iv." — as against the
   * symbols it draws for an unordered point: ●, ○, ■, ◆, a dash. Anything with
   * a letter or a digit in it is counting.
   */
  const counts = (glyph: string | undefined): boolean => {
    const marker = glyph?.trim()
    if (!marker) return false
    // Any script's digits, not only 0-9: a deck numbered ١ ٢ ٣ or १ २ ३ is
    // numbered.
    if (/\p{Nd}/u.test(marker)) return true
    // A letter counts only where something separates it from the text —
    // "a.", "iv)", "B:". A bare letter is a bullet, not a count: Word draws a
    // level-two point as a lowercase "o", and a deck that reached Slides
    // through PowerPoint brings that with it.
    return /^\p{L}+[.)\]:]/u.test(marker)
  }

  /**
   * Whether this paragraph is a numbered or lettered point.
   *
   * Read from the paragraph's own rendered `glyph` first. The list's
   * `glyphType` is the documented place for it and this deck's lists do not
   * state one — every `nestingLevel` came back holding nothing but a bullet
   * style — so a slide numbered "1. 2. 3." with "a. b. c." under it imported
   * as six identical dashes. The glyph is what the author sees, which makes it
   * the better answer even where both are present.
   */
  const isOrdered = (
    bullet:
      { listId?: string; nestingLevel?: number; glyph?: string } | undefined,
    level: number,
  ): boolean => {
    if (!bullet) return false
    if (bullet.glyph !== undefined) return counts(bullet.glyph)
    const type = bullet.listId
      ? lists[bullet.listId]?.nestingLevel?.[String(level)]?.glyphType
      : undefined
    return Boolean(type) && type !== 'GLYPH_TYPE_UNSPECIFIED'
  }

  const runs: SourceRun[] = []
  let bulleted = false
  /** Ends the paragraph that came before, so where one line stops is stated
   * rather than inferred from whether Google happened to include a newline. */
  const endParagraph = () => {
    const previous = runs[runs.length - 1]
    if (previous && !previous.text.endsWith('\n')) previous.text += '\n'
  }
  // Which kind of paragraph the runs that follow belong to. A box is often
  // both — a sentence of context, then points, then a closing line — and read
  // as one kind the prose came back as bullets nobody wrote.
  let inBullet = false
  let level = 0
  let ordered = false
  for (const element of elements) {
    if (element.paragraphMarker) {
      const marker = element.paragraphMarker as {
        bullet?: { listId?: string; nestingLevel?: number; glyph?: string }
      }
      inBullet = Boolean(marker.bullet)
      level = marker.bullet?.nestingLevel ?? 0
      ordered = inBullet && isOrdered(marker.bullet, level)
      if (inBullet) bulleted = true
      endParagraph()
      continue
    }
    const run = element.textRun as
      { content?: string; style?: Record<string, unknown> } | undefined
    if (!run?.content) continue
    /*
     * Where one line ends and the next begins is kept.
     *
     * Slides ends a paragraph with a newline and writes a break INSIDE one as
     * a vertical tab. Stripping both, as this did, flattened a box to its
     * words: four bullet points joined into "OneTwoThreeFour", which is how
     * an exported list came home as a single paragraph. `linesIn`
     * (consolidate) was already splitting on newlines to count what a list
     * held, and so was always counting one.
     *
     * A vertical tab is a line break either way, so it is read as one; the
     * newline that ends the LAST paragraph is dropped after the loop, since
     * that one marks the end of the box rather than a break within it.
     */
    const content = run.content.replace(/\v/g, '\n')
    // Only a run that is nothing but line ends is skipped — an empty
    // paragraph, as before. Not one that is merely blank: Google splits a run
    // wherever styling changes, so the space between a bold word and the next
    // can be a run of its own, and dropping it would join them together.
    if (!content.replace(/\n/g, '')) continue
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
      // Where the author pointed this run, if anywhere.
      ...(typeof (style.link as { url?: string } | undefined)?.url === 'string'
        ? { link: (style.link as { url: string }).url }
        : {}),
      ...(inBullet ? { bulleted: true } : {}),
      ...(inBullet && level ? { bulletLevel: level } : {}),
      ...(ordered ? { ordered: true } : {}),
    })
  }
  const last = runs[runs.length - 1]
  if (last) last.text = last.text.replace(/\n$/, '')
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

/**
 * How a table divides itself, as fractions of its own width and height.
 *
 * Google states a width for every column and a height for every row. Read as
 * fractions of their total, not as lengths, because the box the table lands in
 * is the box the reader measured — what matters is the proportions inside it,
 * which then mean the same thing on screen and in an export (EDIT-7).
 *
 * A table whose sizes are missing or add to nothing gets none, and every
 * surface falls back to equal tracks.
 */
const tableTracksOf = (
  entries: unknown,
  sizeAt: (entry: Record<string, unknown>) => Dimension | undefined,
): number[] | undefined => {
  const list = (entries ?? []) as Record<string, unknown>[]
  if (!Array.isArray(list) || !list.length) return undefined
  const sizes = list.map(entry => emu(sizeAt(entry)))
  const total = sizes.reduce((sum, n) => sum + n, 0)
  if (!total || sizes.some(n => n <= 0)) return undefined
  return sizes.map(n => n / total)
}

/** One shape, whatever it turned out to be. Anything it leaves unset comes
 * from the placeholder it descends from, on its layout or the master. */
/**
 * A shape's own fill, when the shape actually paints one.
 *
 * Google states a colour on a box that has no fill at all: the value is
 * inherited from the placeholder or the master, and `propertyState` is what
 * says whether it is drawn. Reading the colour without reading that put a
 * white rectangle behind every title on a dark deck — the text was still
 * white, so the slide arrived apparently blank.
 *
 * `NOT_RENDERED` is a box with no fill. `INHERIT` means the answer is on the
 * placeholder above, which `shapeChain` has already merged in by the time
 * this is asked, so treating it as no fill of its own is right.
 */
const paintedFill = (
  shape: {
    shapeProperties?: {
      shapeBackgroundFill?: {
        propertyState?: string
        solidFill?: Record<string, unknown>
      }
    }
  },
  scheme: Record<string, string>,
): string | undefined => {
  const fill = shape.shapeProperties?.shapeBackgroundFill
  if (!fill) return undefined
  if (fill.propertyState === 'NOT_RENDERED') return undefined
  if (fill.propertyState === 'INHERIT') return undefined
  return colorOf(fill.solidFill, scheme)
}

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
  // And where it writes where a picture came from (IMG-5/EXP-8), since
  // neither Slides nor PowerPoint has a field for provenance.
  const credit = creditFromToken(raw.description as string | undefined)
  // A credit this system printed under a picture is part of the page, not
  // part of the lecture: it says nothing the picture's own alt text has not
  // already said, and read as content it becomes a caption nobody wrote.
  if (isCreditLine(raw.description as string | undefined)) return null

  const image = raw.image as { contentUrl?: string } | undefined
  if (image) {
    return {
      id,
      kind: 'image',
      box,
      ...(slotName ? { slotName } : {}),
      ...(image.contentUrl ? { imageUrl: image.contentUrl } : {}),
      ...(credit ? { attribution: credit } : {}),
    }
  }

  const table = raw.table as Record<string, unknown> | undefined
  if (table) {
    return {
      id,
      kind: 'table',
      box,
      ...(slotName ? { slotName } : {}),
      table: {
        rows: tableOf(table),
        ...(() => {
          const colWidths = tableTracksOf(
            table.tableColumns,
            column => column.columnWidth as Dimension | undefined,
          )
          const rowHeights = tableTracksOf(
            table.tableRows,
            row => row.rowHeight as Dimension | undefined,
          )
          return {
            ...(colWidths ? { colWidths } : {}),
            ...(rowHeights ? { rowHeights } : {}),
          }
        })(),
      },
    }
  }

  const shape = raw.shape as
    | {
        shapeType?: string
        text?: Record<string, unknown>
        placeholder?: { type?: string }
        shapeProperties?: {
          shapeBackgroundFill?: {
            /** `NOT_RENDERED` is a box with no fill at all, and `INHERIT`
             * defers to the placeholder it descends from. Google states a
             * colour alongside both, so reading the colour without reading
             * this paints boxes the deck leaves transparent. */
            propertyState?: string
            solidFill?: Record<string, unknown>
          }
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
    const fill = paintedFill(shape, scheme)
    if (!fill && !placeholder) return null
    // An empty placeholder still has type: the layout or the master says what
    // size, weight, colour and family a title on this design is set in, even
    // though nobody has typed one yet. Every one of those is read off the
    // RUNS, and an empty box has none — so a deck of untouched placeholders
    // imported with no type at all, and its title and its body came out the
    // same size. The style is carried on an empty run, which is what it is:
    // how this box would be set, with nothing in it yet.
    const empty = inheritedStyle(chain, scheme, page.width)
    return {
      id,
      kind: placeholder ? 'text' : 'decoration',
      box,
      ...(placeholder ? { placeholder } : {}),
      ...(slotName ? { slotName } : {}),
      ...(fill ? { fill } : {}),
      // What the shape is, so an arrow is not drawn as a rectangle.
      ...(shape.shapeType ? { shapeType: shape.shapeType } : {}),
      ...(placeholder && Object.values(empty).some(v => v !== undefined)
        ? { runs: [{ text: '', ...empty }] }
        : {}),
      ...(align ? { align } : {}),
      ...(vAlign ? { vAlign } : {}),
    }
  }

  // A box's own fill, which is part of the design whether or not it holds
  // words. Read only for the empty case before, so a deck whose colour lives
  // on its text boxes rather than on its pages imported white.
  const boxFill = paintedFill(shape, scheme)

  return {
    id,
    kind: 'text',
    box,
    ...(boxFill ? { fill: boxFill } : {}),
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

/** What each text role means, where this page carries it (EXP-8). Read
 * separately from the slots because only theme-building wants it. */
const themeStylesOf = (
  elements: Record<string, unknown>[],
): Record<string, unknown> | undefined => {
  for (const raw of elements) {
    const parsed = parseThemeStyles(raw.description as string | undefined)
    if (parsed) return parsed
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

/** What makes two pieces of decoration the same piece: where it is, what it
 * paints, and what shape it is. The picture counts too — a master and its
 * layout often carry two different marks in the same corner, and keyed without
 * it the second one would be discarded as a repeat of the first. */
const decorationKey = (piece: SourceElement): string =>
  [
    piece.box.x,
    piece.box.y,
    piece.box.w,
    piece.box.h,
    piece.fill ?? '',
    piece.shapeType ?? '',
    piece.imageUrl ?? '',
  ].join('|')

/**
 * The rules and bands a page inherits from the design behind it.
 *
 * A slide's `pageElements` are only what sits ON the slide. The line under
 * every title, the coloured band down the side, the block behind the heading —
 * an author draws those once on the layout or the master, and Google does not
 * repeat them in each slide's elements. Reading only the slide is why an
 * imported deck lost them, and lost them unevenly: a slide where the author
 * had copied the rule onto the slide itself kept it, and its neighbour did
 * not, so the same deck came back with the line on some slides and not others.
 *
 * Only what paints something and holds nothing — an ancestor's placeholders
 * are boxes for content, and the slide has its own.
 *
 * ## A picture on the design is decoration
 *
 * The crest in the corner and the pattern behind the type are `image`
 * elements, not filled shapes, and keeping only the filled ones dropped every
 * one of them: a university deck imported as a flat colour with no mark on it.
 * A picture an author placed on a LAYOUT or a MASTER is part of the design by
 * definition — a box for content is a placeholder, and those are shapes — so
 * it comes across as decoration rather than as a box anyone is asked to fill.
 */
const inheritedDecoration = (
  chain: Record<string, unknown>[],
  page: { width: number; height: number },
  scheme: Record<string, string>,
  ancestry: Ancestry,
  own: SourceElement[],
): SourceElement[] => {
  // What the page already draws itself. An author who copied the rule — or the
  // logo — onto the slide should not end up with it drawn twice.
  const seen = new Set(
    own
      .filter(e => e.kind === 'decoration' || e.kind === 'image')
      .map(decorationKey),
  )
  const inherited: SourceElement[] = []
  // The page itself is the head of the chain; everything behind it is design.
  //
  // Furthest first, because order here is paint order and the master sits
  // behind the layout that is built on it. Taken nearest-first, a master's
  // full-bleed pattern is drawn last — over the crest the layout puts on top
  // of it, and over the band, and over the rule.
  for (const ancestor of chain.slice(1).reverse()) {
    for (const rawElement of flattenGroups(
      (ancestor.pageElements ?? []) as Record<string, unknown>[],
    )) {
      const read = elementOf(rawElement, page, scheme, ancestry)
      if (!read) continue
      const element =
        read.kind === 'image' && read.imageUrl
          ? ({ ...read, kind: 'decoration' } as SourceElement)
          : read
      if (element.kind !== 'decoration') continue
      const key = decorationKey(element)
      if (seen.has(key)) continue
      seen.add(key)
      inherited.push(element)
    }
  }
  return inherited
}

const pageOf = (
  raw: Record<string, unknown>,
  page: { width: number; height: number },
  scheme: Record<string, string>,
  ancestry: Ancestry,
): SourcePage => {
  const rawElements = flattenGroups(
    (raw.pageElements ?? []) as Record<string, unknown>[],
  )
  const chain = pageChain(raw, ancestry)
  const { background, backgroundImage } = backgroundOf(chain, scheme)
  const metadata = metadataOf(rawElements)
  const themeStyles = themeStylesOf(rawElements)
  const notes = notesOf(raw)
  const own = creditedPictures(
    rawElements
      .map(el => elementOf(el, page, scheme, ancestry))
      .filter((el): el is SourceElement => el !== null),
    printedCredits(rawElements),
  )
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
    // The design's own rules and bands go first, because they sit behind what
    // the slide draws on top of them.
    elements: [
      ...inheritedDecoration(chain, page, scheme, ancestry, own),
      ...own,
    ],
    ...(metadata ? { slotMetadata: metadata } : {}),
    ...(themeStyles ? { themeStyles } : {}),
    ...(notes ? { notes } : {}),
  }
}

/**
 * The credits this system printed on a slide, in the words it printed.
 *
 * Read even though the elements themselves are dropped, because a printed
 * credit is the one copy that cannot go missing: the picture's own alt text
 * carries the provenance, but alt text is not ours once the file leaves, and
 * a conversion that drops it would take the licence with it. What is on the
 * page is on the page.
 */
const printedCredits = (rawElements: Record<string, unknown>[]): string[] =>
  rawElements
    .filter(raw => isCreditLine(raw.description as string | undefined))
    .map(raw => {
      const shape = raw.shape as { text?: Record<string, unknown> } | undefined
      return runsOf(shape?.text, {}, DEFAULT_PAGE.width)
        .runs.map(run => run.text)
        .join('')
        .trim()
    })
    .filter(Boolean)

/**
 * Pictures with their provenance, from whichever copy survived.
 *
 * The alt text is preferred: it states the fields exactly, including the URLs
 * a printed line has no room for. The printed line fills in for a picture
 * whose alt text did not come back — which is the whole reason it is read.
 *
 * Matched by order rather than by position: the credits are printed in the
 * order their pictures are drawn, and a slide with one picture — which is
 * nearly all of them — cannot get this wrong.
 */
const creditedPictures = (
  elements: SourceElement[],
  printed: string[],
): SourceElement[] => {
  if (!printed.length) return elements
  let next = 0
  return elements.map(element => {
    if (element.kind !== 'image' || element.attribution) return element
    const line = printed[next++]
    const attribution = creditFromLine(line)
    return attribution ? { ...element, attribution } : element
  })
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
/**
 * The background this deck actually wears.
 *
 * The first slide's was standing in for the deck's, and a title slide is the
 * one page least like the rest: NYU's own template deck opens on violet and
 * is white for ten of its thirteen pages, so the theme came back violet. No
 * imported layout is affected — each paints its own ground as full-bleed
 * decoration (`build-template`) — but the whiteboard has none, and neither
 * does any layout an author adds afterwards, so both sat on a colour the deck
 * uses three times in thirteen.
 *
 * The commonest wins; ties go to the earlier page, so a deck evenly split
 * still reads the same way every time.
 */
const dominantBackground = (pages: SourcePage[]): string | undefined => {
  const counts = new Map<string, number>()
  for (const page of pages) {
    if (!isHex(page.background)) continue
    counts.set(page.background, (counts.get(page.background) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = 0
  for (const [colour, count] of counts) {
    if (count > bestCount) {
      best = colour
      bestCount = count
    }
  }
  return best
}

const themeOf = (
  scheme: Record<string, string>,
  background: string | undefined,
  pages: SourcePage[],
): SourceTheme => {
  const bg = background ?? scheme.LIGHT1 ?? '#ffffff'
  /**
   * Every background this deck actually paints.
   *
   * The theme carries ONE background, but an imported design paints its own
   * on every layout (`build-template` draws it as full-bleed decoration). A
   * colour picked to read on the theme's background is not thereby readable on
   * a page the deck paints white — which is how a deck with a dark title slide
   * came back with its links in near-white, invisible on every light page.
   * The words were there; nothing drew them.
   */
  const painted = [bg, ...pages.map(page => page.background).filter(isHex)]
  /** Readable on every page of the deck, not merely on the first one. */
  const readsEverywhere = (colour: string): boolean =>
    painted.every(on => contrast(colour, on) >= READABLE)
  /**
   * The first of these that can actually be read — everywhere if possible.
   *
   * A theme colour is drawn on every page of the deck, so one that reads on
   * all of them beats one that reads only on the first. This matters most for
   * `accent`, which is not merely decoration: the client draws a hyperlink in
   * it when the deck states no link colour of its own
   * (`client/src/components/slide/theme.ts`). An accent chosen against a dark
   * title slide is near-white, and every linked phrase on the deck's white
   * pages was then drawn white on white.
   *
   * Falling back to the theme background alone, and then to plain ink, because
   * a deck that runs both dark and light may offer nothing that reads on both
   * — and one unreadable page is better than discarding the deck's palette.
   */
  const readable = (...candidates: (string | undefined)[]): string => {
    const hexes = candidates.filter(isHex)
    return (
      hexes.find(readsEverywhere) ??
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
    // Only when the deck states one, it differs from the body, AND it can be
    // read on every page the deck paints. A link the same colour as everything
    // around it is not a decision worth carrying, and one that disappears into
    // half the deck is worse than none: dropping it here leaves the anchor
    // inheriting its box's own colour, which came off the slide and is
    // therefore readable where that box sits.
    ...(isHex(scheme.HYPERLINK) &&
    readable(scheme.HYPERLINK) !== text &&
    readsEverywhere(scheme.HYPERLINK!)
      ? { link: scheme.HYPERLINK }
      : {}),
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
    theme: themeOf(scheme, dominantBackground(slides), [...slides, ...layouts]),
    layouts,
    slides,
  }
}

/**
 * Reads a presentation from Google.
 *
 * A refusal is reported as something the user can act on, and which action
 * that is depends on why: reconnect when the grant is the problem, ask for
 * access when the deck is, and neither when the deployment is misconfigured.
 * Anything else is a failure to read, said plainly.
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
    // Google says 403 for three unrelated things, and only one of them is
    // fixed by reconnecting. The reason is in the body, so it is read rather
    // than assumed.
    const reason = await res.text().catch(() => '')
    // (1) The Slides API is switched off for the whole deployment. Nothing
    // the instructor does can help; telling them to reconnect sends them
    // round a loop that cannot succeed.
    if (
      /has not been used in project|is disabled|accessNotConfigured/i.test(
        reason,
      )
    ) {
      throw new PresentationUnreadableError(
        'The Google Slides API is not enabled for this deployment — an administrator must switch it on',
      )
    }
    // (2) The stored authorization does not cover what this read needs — an
    // account connected before the scope was added, or a token that has gone
    // stale. Reconnecting is exactly the fix.
    if (
      res.status === 401 ||
      /insufficient|invalid_token|ACCESS_TOKEN|expired|unauthenticated|UNAUTHENTICATED/i.test(
        reason,
      )
    ) {
      throw new PresentationUnreadableError(
        'Google would not let this account read that presentation',
        true,
      )
    }
    // (3) The account is fine and this deck is not theirs to open, which is
    // what a pasted link to somebody else's lecture looks like. Reconnecting
    // the same account arrives back at the same refusal, so it is not
    // offered.
    throw new PresentationUnreadableError(
      'This Google account does not have access to that presentation',
      false,
      false,
      true,
    )
  }
  if (res.status === 404) {
    throw new PresentationUnreadableError(
      'That presentation was not found',
      false,
      true,
    )
  }
  if (!res.ok) {
    throw new PresentationUnreadableError(
      `Google Slides read failed (${res.status})`,
    )
  }
  return toSourcePresentation((await res.json()) as Record<string, unknown>)
}
