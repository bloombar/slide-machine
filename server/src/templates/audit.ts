/**
 * Faults a template's own data can be shown to have (TMPL-8/TMPL-9).
 *
 * Written while importing a real Google Slides deck, where it found genuine
 * defects in minutes: a decorative glyph imported as a text slot with a budget
 * of nothing, two boxes of words overlapping, and a palette whose entries had
 * collapsed onto one another. None of those are specific to that deck, or to
 * imports at all — a hand-written template can have every one of them — so
 * this reads any template, built-in or derived.
 *
 * ## What it can and cannot prove
 *
 * It reads the TEMPLATE. So it can only show that a design is self-consistent:
 * that its boxes sit on the slide, that its words do not sit on each other,
 * that a role a box names exists, that text can be read against what is behind
 * it. **It can never show that a design matches the deck it came from.** A
 * template whose every colour was misread will pass cleanly. Only a rendered
 * comparison against the source catches that class, and nothing here is a
 * substitute for one.
 *
 * ## The ground a box sits on is not always the layout's fill
 *
 * Recorded because getting it wrong produced eighteen false faults in one run.
 * A layout states its ground as a full-bleed entry in `decoration`, and it is
 * tempting to compare every box's colour against that. But a full-slide
 * picture — a decoration image, or a box holding one — is drawn OVER the fill,
 * and it is the picture the words actually sit on. A title in the same colour
 * as the fill beneath a photograph is not invisible; it is unjudgeable from
 * the data. Those cases are reported as notes rather than faults, because
 * whether they read depends on a picture this cannot see.
 *
 * ## `Layout` has no background-image field
 *
 * A full-bleed picture on a shipped template is a `decoration` entry carrying
 * an `imageUrl`. `backgroundImage` exists on the importer's own
 * `DerivedLayout`, not on the shared `Layout`, and reaching for it here is the
 * same design-versus-content confusion that produced the ground bug above. A
 * layout's ground and its pictures are read from `decoration`, always.
 *
 * Every rule here earned its place by catching something real. New ones should
 * do the same: an unproven rule produces false faults, and a checker that
 * cries wolf is one people learn to ignore.
 */
import {
  inkBoxOf,
  lineHeightOf,
  themeTextStyles,
  type BoxStyle,
  type Rect,
  type Layout,
  type Template,
} from '@slide-machine/shared'
import { resolveStyle } from '../lib/tree-boxes'
import { linesDown } from '../import/text-metrics'

/** One thing the audit noticed, and where. */
export interface AuditFinding {
  /** Short name of the rule, for grouping — `palette`, `overlap`, … */
  rule: string
  layout?: string
  box?: string
  message: string
}

/**
 * What an audit found.
 *
 * `faults` are defects in the data. `notes` are things worth a reader's
 * attention that the data cannot settle — chiefly anything sitting under a
 * picture — and things a design may legitimately do.
 */
export interface AuditResult {
  faults: AuditFinding[]
  notes: AuditFinding[]
}

/** Slack, as a fraction of the slide. Sub-pixel differences are not defects. */
const EPS = 0.004

/** A text box narrower or shorter than this holds almost nothing — and an
 * imported box's character budget is derived from exactly these numbers, so a
 * sliver is not merely ugly, it is a box the AI is told holds a word or two. */
const MIN_TEXT_W = 0.08
const MIN_TEXT_H = 0.03

/** The palette entries a design distinguishes between. `background` and
 * `surface` are deliberately absent: a flat design sets them the same on
 * purpose, and flagging that would flag correct designs. */
const DISTINCT_ROLES = ['text', 'muted', 'accent'] as const

const rgb = (
  colour: string | undefined,
): [number, number, number] | undefined => {
  if (!colour?.startsWith('#')) return undefined
  const hex =
    colour.length === 4
      ? [...colour.slice(1)].map(c => c + c).join('')
      : colour.slice(1)
  if (hex.length !== 6) return undefined
  const n = Number.parseInt(hex, 16)
  return Number.isNaN(n)
    ? undefined
    : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG relative luminance. */
const luminance = ([r, g, b]: [number, number, number]): number => {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

const contrast = (
  a: [number, number, number],
  b: [number, number, number],
): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** Whether two boxes share more than a rounding error of the slide. */
const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > EPS && h > EPS ? w * h : 0
}

/**
 * The rectangle a box's WORDS occupy, which is what a collision is about.
 *
 * Not the box: NYU Bold's divider draws its title box and its numeral box
 * over one another by 6.1% of the slide, exactly as the source deck does,
 * while the glyphs clear by a third of the title's own type size. Reading
 * rectangles calls that design broken. What the ink model can and cannot
 * promise — including the `Q`-over-`i` case it does not cover — is written
 * in `shared/types/text-ink`, and it is worth reading before trusting a
 * clear result here.
 *
 * A face we ship no metrics for falls back to the box, which is what this
 * rule compared before and is the conservative direction: it can fault a
 * design that is fine, never pass one that is not.
 *
 * Lines are counted as PROSE even for a list, which holds fewer of them for
 * the gap between points. Fewer lines is a shorter run of ink, so counting
 * prose is the generous reading and keeps this from missing a collision.
 */
const inkOf = ([, box, style]: [string, Rect, BoxStyle]): Rect => {
  const leading = lineHeightOf(style)
  if (leading === null || typeof style.fontSize !== 'number') return box
  return (
    inkBoxOf(box, style, linesDown(box, style.fontSize, leading, false)) ?? box
  )
}

/** A full-slide piece — the shape that makes something a ground rather than
 * an ornament. */
const fullBleed = (piece: { w?: number; h?: number }): boolean =>
  (piece.w ?? 0) > 0.98 && (piece.h ?? 0) > 0.98

/**
 * What a layout's words are actually drawn against, and whether a picture
 * makes that unknowable.
 *
 * Later decoration paints over earlier, so the last full-bleed fill wins. A
 * full-slide picture — decoration or box — covers whatever is beneath it.
 */
const groundOf = (
  layout: Layout,
  themeBackground: string | undefined,
): { ground: string | undefined; covered: boolean } => {
  let ground = themeBackground
  // A stored layout has no background-image field of its own: a picture behind
  // everything arrives as a full-bleed decoration piece, which the loop below
  // catches.
  let covered = false
  for (const piece of layout.decoration ?? []) {
    if (!fullBleed(piece)) continue
    if (piece.imageUrl) covered = true
    if (piece.fill) ground = piece.fill
  }
  for (const box of Object.values(layout.elementPositions ?? {}))
    if (fullBleed(box)) covered = true
  return { ground, covered }
}

/**
 * Reads a template and reports what is wrong with it.
 *
 * Takes only the two fields it reads, so a template that is being built — an
 * import's output, before it is a stored `Template` — can be audited too.
 */
export const auditTemplate = (
  template: Pick<Template, 'theme' | 'layouts'>,
): AuditResult => {
  const faults: AuditFinding[] = []
  const notes: AuditFinding[] = []
  const theme = template.theme as Record<string, string | undefined>
  const styles = themeTextStyles(template.theme)
  const declared = new Set(
    Object.keys(
      (template.theme.textStyles as Record<string, unknown> | undefined) ?? {},
    ),
  )

  // A palette entry that is another entry's colour cannot be told from it, so
  // the design has no way to say "quieter" or "emphasised".
  for (let i = 0; i < DISTINCT_ROLES.length; i++)
    for (let j = i + 1; j < DISTINCT_ROLES.length; j++) {
      const [a, b] = [DISTINCT_ROLES[i]!, DISTINCT_ROLES[j]!]
      if (theme[a] && theme[a] === theme[b])
        faults.push({
          rule: 'palette',
          message: `\`${a}\` and \`${b}\` are both ${theme[a]} — one can never be distinguished from the other`,
        })
    }

  for (const layout of template.layouts) {
    const positions = layout.elementPositions ?? {}
    const { ground, covered } = groundOf(layout, theme.background)
    const words: [string, (typeof positions)[string], BoxStyle][] = []

    for (const [name, box] of Object.entries(positions)) {
      const where = { rule: '', layout: layout.type, box: name }

      if (
        box.x < -EPS ||
        box.y < -EPS ||
        box.x + box.w > 1 + EPS ||
        box.y + box.h > 1 + EPS
      )
        faults.push({
          ...where,
          rule: 'off-slide',
          message: `runs past the edge of the slide`,
        })

      // A box holds words if it names a text role, or the template gave it one
      // of the type fields only text has.
      const role = box.textStyle
      if (role && !declared.has(role) && !styles[role])
        faults.push({
          ...where,
          rule: 'undefined-role',
          message: `names the text style \`${role}\`, which the theme does not define — it will fall back to the app's own defaults`,
        })
      if (!role && box.fontSize === undefined) continue
      words.push([name, box, resolveStyle(box, styles)])

      if (box.w < MIN_TEXT_W || box.h < MIN_TEXT_H)
        faults.push({
          ...where,
          rule: 'sliver',
          message: `is ${(box.w * 100).toFixed(1)}% × ${(box.h * 100).toFixed(1)}% of the slide but holds text — a box this size is bounded to almost no characters`,
        })

      // Legibility, read the way the renderer reads it: the role's values with
      // the box's own over the top, and theme words resolved to their colours.
      const resolved = resolveStyle(box, styles)
      const paint = (token: string | undefined) =>
        token && theme[token] ? theme[token] : token
      const fg = rgb(paint(resolved.color))
      const bg = rgb(paint(box.background) ?? ground)
      if (!fg || !bg) continue
      const target = covered ? notes : faults
      if (fg.join() === bg.join())
        target.push({
          ...where,
          rule: 'invisible',
          message: covered
            ? `is the same colour as the fill behind it, but a full-slide picture covers that fill — whether it reads depends on the picture`
            : `is drawn in the same colour as the ground behind it`,
        })
      else {
        const ratio = contrast(fg, bg)
        const floor = (resolved.fontSize ?? 0) >= 4 ? 3 : 4.5
        if (ratio < floor)
          target.push({
            ...where,
            rule: 'contrast',
            message: `is ${ratio.toFixed(2)}:1 against ${covered ? 'the fill behind it, which a full-slide picture covers' : 'its ground'} (${floor}:1 is the floor for this size)`,
          })
      }
    }

    for (let a = 0; a < words.length; a++)
      for (let b = a + 1; b < words.length; b++) {
        const shared = overlaps(inkOf(words[a]!), inkOf(words[b]!))
        if (shared > 0)
          faults.push({
            rule: 'overlap',
            layout: layout.type,
            message: `\`${words[a]![0]}\` and \`${words[b]![0]}\` overlap over ${(shared * 100).toFixed(1)}% of the slide, and both hold text`,
          })
      }
  }

  notes.push(...unanimityNotes(template, declared))
  return { faults, notes }
}

/**
 * Roles that state no colour of their own although nearly all their boxes
 * agree on one.
 *
 * A NOTE, never a fault, and the distinction is the point. A text style takes
 * a property only when every box following it states the same one, so a single
 * dissenting box makes the style silent and leaves all the others restating
 * the colour individually. That found a real defect once: a decorative glyph
 * imported as a title broke unanimity for eleven real titles.
 *
 * But the identical shape is produced by a design that simply uses two
 * colours — a deck setting its titles white over photographs and violet over
 * white pages is doing that on purpose. Nothing in the data tells the two
 * apart, so this reports and does not judge. A rule that cannot tell a defect
 * from a design decision must not be allowed to fail anyone's build.
 */
const unanimityNotes = (
  template: Pick<Template, 'theme' | 'layouts'>,
  declared: Set<string>,
): AuditFinding[] => {
  const styles =
    (template.theme.textStyles as Record<
      string,
      { color?: string } | undefined
    >) ?? {}
  const stated = new Map<string, string[]>()
  for (const layout of template.layouts)
    for (const box of Object.values(layout.elementPositions ?? {}))
      if (box.textStyle && declared.has(box.textStyle) && box.color)
        stated.set(box.textStyle, [
          ...(stated.get(box.textStyle) ?? []),
          box.color,
        ])

  const found: AuditFinding[] = []
  for (const [role, colours] of stated) {
    // `text` counts as stating nothing: it is the neutral a derived style
    // falls back to when its boxes disagree, so a style carrying it has
    // declined to name a colour rather than chosen one. Skipping on any
    // colour at all hid exactly the case this rule exists to notice.
    const declaredColour = styles[role]?.color
    if (colours.length < 2 || (declaredColour && declaredColour !== 'text'))
      continue
    const counts = new Map<string, number>()
    for (const colour of colours)
      counts.set(colour, (counts.get(colour) ?? 0) + 1)
    const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0]!
    if (counts.size > 1 && n * 10 >= colours.length * 7)
      found.push({
        rule: 'unanimity',
        message: `\`${role}\` states no colour of its own though ${n} of ${colours.length} of its boxes agree on ${top}, so those ${n} each restate it — either an odd box out that does not belong to the style, or a design that genuinely uses two colours`,
      })
  }
  return found
}
