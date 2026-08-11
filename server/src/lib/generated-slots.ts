/**
 * What the model wrote, checked against what the layout declares (GEN-11).
 *
 * A layout's boxes are whatever its author named — three code samples and two
 * pictures, if that is the design — so generation cannot return a fixed set of
 * fields. It returns content keyed by the layout's own slot names, and this is
 * where that is turned into something a slide can hold.
 *
 * ## Validated, never trusted
 *
 * The model is asked for a shape; it is not relied on to produce one. Three
 * rules, in order:
 *
 *   - **Content for a slot the layout does not declare is discarded.** A slide
 *     is never left holding something its template has no box for.
 *   - **Content of the wrong shape is coerced where that is unambiguous** — a
 *     lone string for a list is one point the model forgot to wrap — and
 *     **dropped where it is not**. A bare `5` where a list belongs is not a
 *     list, and guessing at a table from a paragraph would invent structure
 *     the lecturer never said.
 *   - **A specialized kind is only ever produced where a template declares
 *     one.** A history template that declares no maths box can never yield a
 *     formula, because the box it would go in does not exist.
 *
 * ## The conventional four travel separately
 *
 * `title`, `body`, `bullets` and `caption` keep their own place on the result,
 * because the slide DTO derives fields from them and a great deal of the
 * system reads those. Everything else the layout declares comes back keyed by
 * name. The model does not see this split — it returns one object — and the
 * two halves are put back together on the slide.
 */
import type {
  LayoutDescriptor,
  SlotKind,
  SlotSpec,
  SlotValue,
} from '@slide-machine/shared'

/** Whether anything survived validation. A "new" slide holding nothing is
 * not a slide, so a caller turns this into "no decision" rather than putting
 * an empty one in front of a lecture (GEN-11). */
export const hasContent = (split: SplitSlots): boolean =>
  Boolean(
    split.title?.trim() ||
    split.body?.trim() ||
    split.bullets?.length ||
    split.caption?.trim() ||
    Object.keys(split.declared).length,
  )

/** The conventional boxes, which the result carries as fields of their own. */
const CONVENTIONAL = ['title', 'body', 'bullets', 'caption'] as const

/** Content as the model returns it: one object, keyed by slot name. */
export type RawSlots = Record<string, unknown>

/** What a slide is given: the conventional four, and everything else by name. */
export interface SplitSlots {
  title?: string
  body?: string
  bullets?: string[]
  caption?: string
  /** Boxes the layout declares beyond the conventional four (TMPL-9). */
  declared: Record<string, SlotValue>
}

const asText = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  // A number or a boolean is unambiguously its own text; anything with
  // structure is not, and inventing prose from it would be a fabrication.
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return undefined
}

const asList = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const items = value.map(asText).filter((t): t is string => t !== undefined)
    return items.length ? items : undefined
  }
  // One string where a list was asked for is a list of one — the model wrote
  // a single point and did not wrap it, which is unambiguous. A bare number
  // is not: `5` as a bullet reading "5" is nonsense on a slide, so it is
  // dropped rather than coerced.
  return typeof value === 'string' && value.trim() ? [value] : undefined
}

/** Rows and columns, from either shape a model plausibly returns. */
const asTable = (value: unknown): SlotValue | undefined => {
  const rowsOf = (raw: unknown): string[][] | undefined => {
    if (!Array.isArray(raw)) return undefined
    const rows = raw
      .map(row => (Array.isArray(row) ? row.map(asText) : undefined))
      .filter((row): row is (string | undefined)[] => row !== undefined)
      .map(row => row.map(cell => cell ?? ''))
    return rows.length ? rows : undefined
  }
  if (Array.isArray(value)) {
    const rows = rowsOf(value)
    return rows ? { kind: 'table', rows } : undefined
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const rows = rowsOf(record.rows)
    if (!rows) return undefined
    const header = Array.isArray(record.header)
      ? record.header.map(cell => asText(cell) ?? '')
      : undefined
    return {
      kind: 'table',
      ...(header?.length ? { header } : {}),
      rows,
    }
  }
  return undefined
}

/**
 * One box's content, in the shape its declared kind calls for, or nothing.
 *
 * A picture is never written by the model: an image slot is filled by
 * enrichment from the keywords it gives instead (GEN-7/IMG-6), and a URL the
 * model invented would point at nothing.
 */
/**
 * Whether what came back for a code box is actually a program.
 *
 * The prompt tells the model a code box holds a listing and never a sentence
 * about one, and most of the time it obeys. Most of the time is not a
 * guarantee: the same prompt returns "A while loop continues as long as n is
 * greater than 10, containing an if-else statement" often enough that an
 * instructor sees it. Nothing downstream could tell that from code — it is a
 * non-empty string either way — so it rendered in a monospaced box, looking
 * exactly like the listing it was describing.
 *
 * So the shape is checked rather than trusted. Real code carries at least one
 * of: a line break, an assignment or comparison, a call, a block character, or
 * a keyword in a code position. English prose about code carries none of them
 * and ends in a full stop.
 *
 * Deliberately permissive — a one-line `print(x)` must pass, and anything
 * genuinely ambiguous is kept. It only has to catch the sentence.
 */
export const looksLikeCode = (source: string): boolean => {
  const text = source.trim()
  if (!text) return false
  // More than one line is already more than a sentence.
  if (/\n/.test(text)) return true
  // A call, an assignment, a comparison, a block, an index, a terminator.
  if (/[(){}[\];]|[^=!<>]=[^=]|[=!<>]=|->|=>|\+\+|::/.test(text)) return true
  // A lone keyword line — `pass`, `continue`, `return x`.
  if (
    /^(pass|break|continue|return|import|from|def|class|let|const|var)\b/i.test(
      text,
    )
  )
    return true
  return false
}

/**
 * Whether what came back for a maths box is actually an expression.
 *
 * The same failure, in the same place: "The quadratic formula gives the roots
 * of a quadratic equation." is prose, and typesetting it produces a line of
 * upright words pretending to be mathematics.
 *
 * Real LaTeX carries a command, a symbol, or an operator between operands.
 * A sentence of ordinary words carries none.
 */
export const looksLikeMath = (tex: string): boolean => {
  const text = tex.trim()
  if (!text) return false
  // A LaTeX command, a script, a fraction bar, a relation or an operator.
  if (/\\[a-zA-Z]+|[_^{}]|[=<>+\-*/^]|\\\\/.test(text)) return true
  // A bare symbol or single variable is legitimate maths.
  return text.length <= 3
}

export const valueForKind = (
  kind: SlotKind,
  raw: unknown,
  options?: Record<string, unknown>,
): SlotValue | undefined => {
  switch (kind) {
    case 'text': {
      const value = asText(raw)
      return value?.trim() ? { kind: 'text', value } : undefined
    }
    case 'preformatted': {
      const value = asText(raw)
      return value?.trim() ? { kind: 'preformatted', value } : undefined
    }
    case 'bullets': {
      const items = asList(raw)
      return items ? { kind: 'bullets', items } : undefined
    }
    case 'code': {
      const source = asText(raw)
      if (!source?.trim() || !looksLikeCode(source)) return undefined
      const language =
        typeof options?.language === 'string' ? options.language : undefined
      return { kind: 'code', source, ...(language ? { language } : {}) }
    }
    case 'math': {
      const tex = asText(raw)
      return tex?.trim() && looksLikeMath(tex)
        ? { kind: 'math', tex }
        : undefined
    }
    case 'table':
      return asTable(raw)
    case 'image':
      return undefined
  }
}

/**
 * Splits what the model returned into the conventional four and the rest,
 * keeping only what the chosen layout declares.
 *
 * A layout the deck has no descriptor for keeps the conventional four and
 * nothing else: without a list of boxes there is no way to know what a name
 * refers to, and inventing one would put content somewhere no design asked
 * for.
 */
export const splitGeneratedSlots = (
  raw: RawSlots | undefined,
  layoutType: string,
  descriptors: LayoutDescriptor[],
): SplitSlots => {
  const source = raw ?? {}
  const specs: SlotSpec[] =
    descriptors.find(d => d.type === layoutType)?.slots ?? []

  const out: SplitSlots = { declared: {} }
  const conventional = new Set<string>(CONVENTIONAL)

  for (const spec of specs) {
    if (!(spec.name in source)) continue
    const value = valueForKind(spec.kind, source[spec.name], spec.options)
    if (!value) continue
    if (conventional.has(spec.name)) {
      // These keep their own place on the result; the slide derives its
      // fields from them.
      if (spec.name === 'bullets' && value.kind === 'bullets')
        out.bullets = value.items
      else if (value.kind === 'text' || value.kind === 'preformatted')
        out[spec.name as 'title' | 'body' | 'caption'] = value.value
      else out.declared[spec.name] = value
      continue
    }
    out.declared[spec.name] = value
  }

  // A layout with no descriptor still has the conventional boxes: every
  // built-in names them, and a deck whose template failed to resolve should
  // still take the lecturer's words.
  if (!specs.length) {
    const title = asText(source.title)
    const body = asText(source.body)
    const caption = asText(source.caption)
    const bullets = asList(source.bullets)
    if (title?.trim()) out.title = title
    if (body?.trim()) out.body = body
    if (caption?.trim()) out.caption = caption
    if (bullets) out.bullets = bullets
  }

  return out
}

/**
 * Only the boxes a given layout declares (GEN-11).
 *
 * The layout a slide ends up on is not always the one the content was checked
 * against: image reconciliation moves a slide to a layout that can hold its
 * picture (GEN-7), and a slide the user is drawing on keeps the layout it has
 * whatever the model chose (WB-1/WB-3). Either way the answer is the same —
 * a slide is never left holding something its template has no box for.
 */
export const onlyDeclaredBy = (
  declared: Record<string, SlotValue> | undefined,
  layoutType: string,
  descriptors: LayoutDescriptor[],
): Record<string, SlotValue> => {
  if (!declared) return {}
  const names = new Set(
    descriptors.find(d => d.type === layoutType)?.slots.map(s => s.name) ?? [],
  )
  return Object.fromEntries(
    Object.entries(declared).filter(([name]) => names.has(name)),
  )
}
