/**
 * The type scale an imported design turns out to have been built on
 * (TMPL-8/TMPL-9).
 *
 * A hand-written template states its typography once, as named roles —
 * `title`, `body`, `caption` — and every box says which role it follows
 * (docs/TEMPLATES.md §4). That is what makes a template tunable: recolouring
 * the headings, or setting them a point smaller, is one edit in one place.
 *
 * An import used to arrive with no roles at all. Every box carried the size,
 * weight, family and colour measured off its own slide, so a design of thirty
 * layouts held a hundred private type declarations that happened to agree.
 * Nothing was wrong on screen and everything was wrong to work with: an
 * instructor who wanted their headings a shade darker had to visit every box
 * in the template, and the AI was told what each box holds by geometry alone.
 *
 * A presentation is not written to a scale, but it is nearly always SET to
 * one — a deck has three or four type sizes, used over and over. So the scale
 * is recovered rather than invented: the sizes are clustered, the clusters
 * are ranked, and the conventional roles are handed out in that order.
 *
 * ## What this deliberately changes on screen
 *
 * Sizes within `TOLERANCE` of one another collapse onto one — a title set at
 * 40pt on most slides and 38pt on two of them becomes one `title` role at the
 * size the deck used most. That is the point rather than a side effect: an
 * author who nudged one slide's title did not mean to define a second kind of
 * title, and a scale that preserved every such nudge would not be a scale.
 * The tolerance is narrower than the gap between adjacent roles, so a box
 * never crosses into looking like a different role.
 *
 * Nothing else moves. A role takes a MEASURED property only when every box
 * that follows it already stated the same one, so no box can gain a colour, a
 * weight or a family it did not have; a box that differs keeps its own value,
 * which still wins over the role (`resolveStyle`, client).
 *
 * ## Why a role states things the deck never said
 *
 * A role is written out in FULL — every property, measured where the deck
 * said and neutral where it did not — and that is load-bearing rather than
 * tidy. A template's theme is resolved against the app's own defaults field
 * by field (`themeTextStyles`), so a property a role leaves out is not left
 * out at all: it is supplied by whatever the app's `title` or `caption`
 * happens to be. Silence about a weight the deck's titles disagreed on would
 * come back as `700` and embolden every imported title that was not bold;
 * silence about a caption's colour would come back as `muted` and grey out
 * black captions.
 *
 * So where the deck said nothing, the role says what the box was already
 * being drawn with before any of this existed: the weight, slant and family a
 * box inherited from the page, and the line height the app sets on every
 * element. Stating them changes nothing and stops the defaults speaking for a
 * design that never asked them to.
 *
 * ## What is not derived
 *
 * A role the deck gives no evidence for is not emitted, and falls back to the
 * app's default exactly as it does for a template that states no scale at all
 * (`DEFAULT_TEXT_STYLES`). Guessing a `quote` style for a deck with no quotes
 * would put an invented style in front of an author as if their deck had
 * asked for it.
 */
import type { TextStyleSpec } from '@slide-machine/shared'
import type { CandidateSlot } from './candidate'
import type { DerivedLayout } from './consolidate'
import { mapFont } from './font-map'
import { capacityOf } from './text-metrics'

/**
 * How far two type sizes may sit apart and still be the same role, as a
 * share of the larger.
 *
 * Eight percent merges the sizes a deck varies by accident — 40pt and 38pt,
 * or a box Slides autofitted down a step — and keeps apart the sizes it
 * varies on purpose, since a scale's adjacent steps are further apart than
 * that. Measured against the size that OPENED the cluster rather than the
 * last one added, so a long run of near-neighbours cannot drift a cluster
 * arbitrarily far from where it started.
 */
const TOLERANCE = 0.08

/** The roles handed out above the body size, largest first. A deck with
 * fewer distinct heading sizes than this uses the front of the list — two
 * sizes are a title and a heading, not a title and a section title, because
 * `heading` is the one the conventional layouts put over content. */
const ABOVE_BODY = ['title', 'sectionTitle', 'heading']

/**
 * The role a box's NAME already claims.
 *
 * By the time a design reaches here its boxes have been named — from the
 * source's own placeholder types where it had them, from what the box holds
 * and where it sits otherwise (`candidate.ts`). That naming is evidence about
 * typography and it costs nothing to read: a deck whose every text box is a
 * `title` should not have its one type size called `body` merely because it
 * is the only size there is.
 *
 * Used to name the anchor cluster only. Ranking still decides everything
 * else, because a name says what a box IS and only the sizes say how the deck
 * is SET — a design with four boxes called `title` at four sizes has one
 * title and three headings, whatever they are called.
 *
 * `bullet` is deliberately absent: which boxes are lists is known exactly
 * from their kind, and a box merely NAMED `bullets` that holds prose would
 * take the list role away from the boxes that are lists.
 */
const NAMED_ROLES: { role: string; pattern: RegExp }[] = [
  { role: 'sectionTitle', pattern: /^section/i },
  { role: 'title', pattern: /^title/i },
  { role: 'heading', pattern: /^(heading|subhead)/i },
  { role: 'quote', pattern: /^quote/i },
  { role: 'caption', pattern: /^(caption|subtitle|footnote)/i },
  { role: 'body', pattern: /^body/i },
]

const roleFromName = (name: string): string | undefined =>
  NAMED_ROLES.find(r => r.pattern.test(name))?.role

/** What the derivation found: the styles to store on the theme, and which
 * role each box follows. */
export interface TypeScale {
  /** The template's `theme.textStyles`. Absent when the deck stated no type
   * at all — a deck of pictures, or one whose text carried no size. */
  styles?: Record<string, TextStyleSpec>
  /** The role a box follows, keyed by the box itself. A box the scale could
   * not place is absent and keeps its own type. */
  roleOf: Map<CandidateSlot, string>
  /** What each role's colour actually resolves to, so a box can tell whether
   * its own colour is already the role's. Kept apart from `styles` because
   * the stored value may be a theme NAME (`accent`) and this is the literal
   * behind it. */
  colorOf: Map<string, string>
}

/**
 * What a box was already being drawn with where its deck said nothing.
 *
 * Not a house style and not a guess — each of these is what an imported box
 * actually rendered as before any of its type was named, so stating them
 * moves nothing:
 *
 *   - the app's default sans, which a box naming no family inherited
 *   - ordinary weight and upright, which is what a box that was neither bold
 *     nor italic was drawn at (the importer reads no slant at all, so no
 *     imported box has ever been italic)
 *   - `1.5`, the line height set on every element on the page, and the same
 *     figure the capacity arithmetic assumes (`text-metrics`) — so what a box
 *     is told it holds and what it draws finally agree
 *   - the theme's own text colour, which an uncoloured box inherited
 */
const INHERITED = {
  fontFamily: 'sans',
  fontWeight: 400,
  italic: false,
  lineHeight: 1.5,
  color: 'text',
} as const

/** A run of boxes set at about the same size. */
interface Cluster {
  /** The size the cluster stands for: the one most of its boxes are set at. */
  size: number
  slots: CandidateSlot[]
}

/** Boxes that hold words and said how big they are. Everything else — a
 * picture, a table, a box whose source stated no size — has no type to
 * contribute and nothing a role could tell it. */
const typedSlots = (layouts: DerivedLayout[]): CandidateSlot[] =>
  layouts
    .flatMap(layout => layout.slots)
    .filter(
      slot =>
        (slot.kind === 'text' || slot.kind === 'bullets') &&
        typeof slot.fontSize === 'number' &&
        slot.fontSize > 0,
    )

/** The value most of a set states, or nothing when the set is empty. Ties go
 * to the value seen first, so the result does not depend on map ordering. */
const dominant = <T>(values: T[]): T | undefined => {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: T | undefined
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/** The middle value of a set, rounded. Median rather than mean because one
 * unusually large box should not raise the budget for all the others. */
const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.floor(sorted.length / 2)]!)
}

/**
 * Groups boxes by the size they are set at.
 *
 * Descending, so a cluster is opened by its largest member and every later
 * size is compared against that one. Comparing against the running edge
 * instead would let 40, 37, 34, 31 chain into a single cluster in which
 * nothing is within the tolerance of anything else.
 */
const clusterBySize = (slots: CandidateSlot[]): Cluster[] => {
  const sorted = [...slots].sort((a, b) => b.fontSize! - a.fontSize!)
  const groups: CandidateSlot[][] = []
  let anchor = 0
  for (const slot of sorted) {
    const size = slot.fontSize!
    if (!groups.length || size < anchor * (1 - TOLERANCE)) {
      groups.push([slot])
      anchor = size
      continue
    }
    groups[groups.length - 1]!.push(slot)
  }
  return groups.map(members => ({
    // The size the deck actually used most, not the average of a cluster and
    // not the size that happened to open it: a title set at 40pt thirty times
    // and 44pt once is a 40pt title.
    size: dominant(members.map(m => m.fontSize!))!,
    slots: members,
  }))
}

/**
 * Which role each cluster becomes.
 *
 * The body size is the anchor, and it is the size the deck gives the most
 * ROOM to: the total area of the prose boxes set in it. Everything above it
 * is a heading of some rank and everything below it is a caption.
 *
 * Area rather than a count of boxes, because counting gets a title-heavy deck
 * backwards. A deck of section slides can hold more title boxes than body
 * boxes and is still not written in its title face — what makes a size the
 * reading size is how much of the page is given over to it, and a title is a
 * strip where a body is a block. Area says that directly, needs no content to
 * measure, and cannot be swayed by a deck that simply has many short slides.
 *
 * Above the body the three roles go to the three most WIDELY USED sizes, and
 * only then in size order. A deck with one 60pt number on one slide and a
 * 32pt heading on forty should call the 32pt one a heading; ranking by size
 * alone would hand `title` to the one-off and leave the real heading unnamed.
 */
const assignRoles = (
  clusters: Cluster[],
  bulletCluster: Cluster | undefined,
): Map<Cluster, string> => {
  const roles = new Map<Cluster, string>()
  /** How many of the deck's prose boxes are set at this size. */
  const prose = (c: Cluster) => c.slots.filter(s => s.kind === 'text').length

  /**
   * The body anchor: the SMALLEST prose size the deck uses substantially, or —
   * in a deck that is all lists — the list size, so there is still a middle to
   * rank from.
   *
   * Both halves of that are load-bearing, and each fixes a way the other
   * fails. Taking the most-used size alone gets a TEMPLATE deck backwards: an
   * official template deck is mostly title and statement slides, and NYU's
   * runs twelve display boxes against ten of body — so "most used" and "most
   * page area" both called its 5.8cqi display size the reading size, which
   * left the deck with no `body` role at all and set its paragraphs in
   * `caption`. Taking the smallest size alone is worse: that is the caption,
   * on every deck that has one.
   *
   * Together they say what a reading size actually is — the smallest size a
   * design uses OFTEN. A caption is small and rare, a title is common and
   * large, and body is the only thing that is both small and common.
   *
   * "Substantially" is measured against the deck's own most-used prose size
   * rather than an absolute figure, so this reads the same whatever units or
   * type scale a deck happens to be drawn at.
   */
  const busiest = Math.max(0, ...clusters.map(prose))
  const anchor =
    [...clusters]
      .filter(c => prose(c) > 0 && prose(c) * 2 > busiest)
      .sort((a, b) => a.size - b.size)[0] ?? bulletCluster
  if (!anchor) return roles

  const above = clusters
    .filter(c => c.size > anchor.size)
    .sort((a, b) => b.slots.length - a.slots.length)
    .slice(0, ABOVE_BODY.length)
    .sort((a, b) => b.size - a.size)

  /**
   * What the anchor is CALLED, in the one case where nothing else can say.
   *
   * A deck whose only text size belongs to boxes called `title` is a deck of
   * titles, and calling that size `body` would put the word in front of an
   * author as if their design had asked for it.
   *
   * Everywhere else the anchor is `body`, and deliberately so on two counts.
   * Ranking already knows the order, and letting a name override it would
   * invert the scale — a `sectionTitle` set larger than the `title` above it.
   * And `body` is the role the conventional layouts, the slot budgets and the
   * generation prompt are all written around: a deck that emitted `quote`
   * instead would render correctly and leave an author editing "body" with
   * nothing to edit.
   *
   * A name must also be held by a MAJORITY of the anchor's boxes, not merely
   * by most of the boxes that happened to claim anything. Only a name that
   * matches a role votes, so three boxes called `prose` are silent and one
   * called `quoted` would otherwise carry the whole cluster one to nothing.
   */
  const votes = anchor.slots.flatMap(s => {
    const role = roleFromName(s.name)
    return role ? [role] : []
  })
  const named = dominant(votes)
  const majority =
    !!named && votes.filter(v => v === named).length * 2 > anchor.slots.length
  const anchorRole = !above.length && named && majority ? named : 'body'
  roles.set(anchor, anchorRole)

  // Two heading sizes are a title and a heading. `sectionTitle` is the middle
  // rank and only exists once there are three.
  const ranks = above.length === 2 ? ['title', 'heading'] : ABOVE_BODY
  above.forEach((cluster, i) => roles.set(cluster, ranks[i]!))

  const below = clusters
    .filter(c => c.size < anchor.size)
    .sort((a, b) => b.slots.length - a.slots.length)[0]
  if (below && anchorRole !== 'caption') roles.set(below, 'caption')

  return roles
}

/**
 * A property the role may carry.
 *
 * Only when EVERY box that will follow the role already states the same
 * value. A role that carried the majority's colour would give it to the
 * minority too — a box that stated no colour would gain one, which is a
 * design change nobody asked for. Where the boxes disagree the role stays
 * silent and each box keeps its own.
 */
const agreedOn = <T>(
  slots: CandidateSlot[],
  read: (slot: CandidateSlot) => T | undefined,
): T | undefined => {
  const values = slots.map(read)
  if (!values.length || values.some(v => v === undefined)) return undefined
  const first = values[0]
  return values.every(v => v === first) ? first : undefined
}

/** The theme entry a literal colour is already the value of, so a role stores
 * `accent` rather than `#57068c` and follows the palette when an author
 * recolours the template. */
const namedColor = (
  literal: string,
  palette: Record<string, string | undefined>,
): string => {
  const wanted = literal.trim().toLowerCase()
  for (const [name, value] of Object.entries(palette))
    if (value?.trim().toLowerCase() === wanted) return name
  return literal
}

/**
 * Recovers the scale a deck was set on.
 *
 * `palette` is the theme the same import is building, so a role's colour can
 * be stored by name where the deck's own palette already has a word for it.
 */
export const deriveTypeScale = (
  layouts: DerivedLayout[],
  palette: Record<string, string | undefined> = {},
): TypeScale => {
  const empty: TypeScale = { roleOf: new Map(), colorOf: new Map() }
  const typed = typedSlots(layouts)
  if (!typed.length) return empty

  const clusters = clusterBySize(typed)
  // Which cluster the deck's lists live in. Lists and body prose are usually
  // the same size, and then one cluster carries both roles — which is right:
  // `body` and `bullet` are two things to say about the same reading size.
  const bulletCluster = [...clusters].sort(
    (a, b) =>
      b.slots.filter(s => s.kind === 'bullets').length -
      a.slots.filter(s => s.kind === 'bullets').length,
  )[0]
  const hasBullets = bulletCluster?.slots.some(s => s.kind === 'bullets')

  const clusterRoles = assignRoles(
    clusters,
    hasBullets ? bulletCluster : undefined,
  )

  // Every box's role, and the boxes behind each role — the same grouping read
  // both ways, since the styles are built from the boxes that will follow
  // them rather than from the cluster they happened to be measured in.
  const roleOf = new Map<CandidateSlot, string>()
  for (const cluster of clusters) {
    const role = clusterRoles.get(cluster)
    const isBulletHome = hasBullets && cluster === bulletCluster
    for (const slot of cluster.slots) {
      if (slot.kind === 'bullets' && isBulletHome) {
        roleOf.set(slot, 'bullet')
        continue
      }
      if (role) roleOf.set(slot, role)
    }
  }
  if (!roleOf.size) return empty

  const members = new Map<string, CandidateSlot[]>()
  for (const [slot, role] of roleOf) {
    const list = members.get(role) ?? []
    list.push(slot)
    members.set(role, list)
  }

  const styles: Record<string, TextStyleSpec> = {}
  const colorOf = new Map<string, string>()
  for (const [role, slots] of members) {
    // The size every box of the role adopts. Taken from the cluster the boxes
    // sit in, so `body` and `bullet` sharing a cluster share a size.
    const size = dominant(slots.map(s => s.fontSize!))!
    const color = agreedOn(slots, s => s.color)
    if (color) colorOf.set(role, color)
    // Agreed on the STACK the family becomes, not on the name the source
    // used: Helvetica and Arial are one typeface as far as anything here can
    // reproduce, and calling that a disagreement would leave the role silent
    // about a face both boxes share. Storing the stack also means the theme
    // holds something the renderer can actually draw.
    const family = agreedOn(slots, s => mapFont(s.fontFamily))
    const capacities = slots.map(capacityOf)
    // What a box set in this role holds, from the boxes that already are.
    // A budget for the boxes an author adds LATER: every imported box carries
    // its own measured capacity, which is more specific and wins
    // (`slotLimits`).
    const maxChars = median(
      capacities.flatMap(c => (c.maxChars ? [c.maxChars] : [])),
    )
    const maxItems = median(
      capacities.flatMap(c => (c.maxItems ? [c.maxItems] : [])),
    )
    styles[role] = {
      fontSize: size,
      // Every property stated, measured where the deck said and neutral where
      // it did not — see the note on the module. A role that left one out
      // would have the app's own default answer for it.
      fontFamily: family ?? INHERITED.fontFamily,
      // Bold is a property a box either states or does not, so a role is only
      // bold when the whole role is — otherwise it would embolden the boxes
      // that were not.
      fontWeight: slots.every(s => s.bold) ? 700 : INHERITED.fontWeight,
      italic: INHERITED.italic,
      lineHeight: INHERITED.lineHeight,
      color: color ? namedColor(color, palette) : INHERITED.color,
      ...(maxChars ? { maxChars } : {}),
      ...(role === 'bullet' && maxItems ? { maxItems } : {}),
    }
  }

  return { styles, roleOf, colorOf }
}

/**
 * A box's own type, with everything its role already says removed.
 *
 * What is left is the box's disagreements with the scale, and those still
 * win — a box's explicit field beats the role's (`resolveStyle`, client). So
 * a title set in the deck's one odd colour keeps that colour while following
 * `title` for everything else.
 */
export const typeOfBox = (
  slot: CandidateSlot,
  scale: TypeScale,
  /**
   * The role the box is KNOWN to have followed, where the file said so
   * (EXP-8). It replaces the derived role rather than being applied over the
   * result, because what this function returns is the box's disagreements
   * with a particular role — subtract against the derived one and then rename
   * the box to another, and the box is left naming a role it was never
   * measured against. A small title restored as `title` in a deck whose
   * derived `title` is twice its size would come back at the derived size,
   * its own having been dropped as redundant.
   *
   * Honoured only where the scale actually defines it: a role with nothing
   * behind it resolves against the app's defaults and restyles the box.
   */
  restored?: string,
): {
  textStyle?: string
  fontSize?: number
  fontWeight?: number
  fontFamily?: string
  color?: string
} => {
  const derived = scale.roleOf.get(slot)
  const role = restored && scale.styles?.[restored] ? restored : derived
  const style = role ? scale.styles?.[role] : undefined
  const family = mapFont(slot.fontFamily)
  // A role the box was not measured into cannot speak for its size.
  //
  // Dropping a box's own size is the NORMALIZATION onto the scale, and it is
  // only sound for the role the box's size actually helped derive — that role
  // stands for the cluster this box sits in. A restored role is different
  // evidence: it says what the box was called, not what it was set in. A
  // small title restored as `title` in a deck whose titles are twice its size
  // is a genuine deviation, and dropping it would resize the box to a cluster
  // it was never in.
  const measuredInto = role === derived
  return {
    ...(role ? { textStyle: role } : {}),
    // The role's size replaces the box's only where the box helped derive it.
    ...(slot.fontSize !== undefined &&
    (style?.fontSize === undefined ||
      (!measuredInto && style.fontSize !== slot.fontSize))
      ? { fontSize: slot.fontSize }
      : {}),
    ...(slot.bold && style?.fontWeight !== 700 ? { fontWeight: 700 } : {}),
    ...(family && style?.fontFamily !== family ? { fontFamily: family } : {}),
    // Compared against what the role's colour MEANS, not how it is stored:
    // the role may hold the word `accent` and the box the hex behind it.
    ...(slot.color && (!role || scale.colorOf.get(role) !== slot.color)
      ? { color: slot.color }
      : {}),
  }
}
