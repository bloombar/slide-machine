/**
 * Matching a layout's boxes to another layout's boxes (GEN-9).
 *
 * Switching a slide's layout swaps one set of boxes for another. Two things
 * need to know which old box became which new one:
 *
 *   - the slide's content, so text follows its box instead of being stranded
 *     under a slot name the new layout does not declare
 *   - the transition animation, so a box morphs to its new place rather than
 *     cross-fading
 *
 * They must agree. A morph that glides one box into another says the text
 * moved there; if the content did not actually follow, the animation lied.
 * So both read the pairing from here.
 *
 * Boxes pair on two signals, in order:
 *
 *   1. The slot NAME. Layouts that share the conventional names (every
 *      built-in does) pair exactly, and nothing below runs.
 *   2. What the box HOLDS: its kind, plus the tier of its text style.
 *
 * Tier, not the text style itself. The style is what legitimately CHANGES
 * across layouts for the same content — a title box is `title` in the title
 * layout and `sectionTitle` in the section layout, and animating that size
 * change is the whole point of the morph. Pairing on style equality would
 * refuse to match exactly the boxes that most need matching, so the roles
 * collapse into four tiers and the pairing runs on those.
 */
import type { Layout, LayoutNode, SlotSpec, SlotKind } from './template'

/**
 * What a box holds, coarsely enough that two layouts can be compared.
 *
 * `image` and `list` come from the slot's kind; the rest split the text
 * kind by the tier of its style, since "the headline" and "the caption"
 * are not interchangeable even though both are text.
 */
export type SlotTier = 'headline' | 'prose' | 'list' | 'caption' | 'image'

/**
 * Which tier each named text style belongs to.
 *
 * `title`/`sectionTitle`/`heading` are one tier because they are the same
 * box at three sizes — that is precisely the pairing the animation needs.
 * `quote` sits with `body`: a quote layout's body IS the content paragraph,
 * just set differently.
 */
export const TIER_FOR_TEXT_STYLE: Record<string, SlotTier> = {
  title: 'headline',
  sectionTitle: 'headline',
  heading: 'headline',
  body: 'prose',
  quote: 'prose',
  bullet: 'list',
  caption: 'caption',
}

/**
 * The tier a box falls in. Kind decides it outright for pictures and lists;
 * text asks its style, and text with no style (the editor's "Custom") falls
 * back to prose — the tier that says least, so an unstyled box never
 * captures a headline or a caption away from a box that named itself one.
 */
export const tierOf = (
  kind: SlotKind,
  textStyle: string | undefined,
): SlotTier => {
  if (kind === 'image') return 'image'
  if (kind === 'bullets') return 'list'
  return (textStyle ? TIER_FOR_TEXT_STYLE[textStyle] : undefined) ?? 'prose'
}

/**
 * The text style each slot follows, read from wherever the layout keeps it:
 * the tree for a layout that has one, `elementPositions` for a layout that
 * is bare geometry (an imported design, TMPL-8).
 */
export const textStylesBySlot = (
  layout: Pick<Layout, 'tree' | 'elementPositions'>,
): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {}
  const walk = (node: LayoutNode | undefined): void => {
    if (!node) return
    if (node.slot) out[node.slot] = node.style?.textStyle
    for (const child of node.children ?? []) walk(child)
  }
  walk(layout.tree)
  for (const [name, box] of Object.entries(layout.elementPositions ?? {})) {
    if (!(name in out)) out[name] = box.textStyle
  }
  return out
}

/** A layout's boxes as the pairing sees them: a name and what it holds. */
export interface TieredSlot {
  name: string
  kind: SlotKind
  tier: SlotTier
}

/** Reads a layout's boxes in declaration order, each tagged with its tier. */
export const tieredSlots = (
  layout: Pick<Layout, 'slots' | 'tree' | 'elementPositions'>,
): TieredSlot[] => {
  const styles = textStylesBySlot(layout)
  return (layout.slots ?? []).map((spec: SlotSpec) => ({
    name: spec.name,
    kind: spec.kind,
    tier: tierOf(spec.kind, styles[spec.name]),
  }))
}

/** How one layout's boxes map onto another's. */
export interface SlotPairing {
  /** Old slot name → new slot name, for every box that found a partner. */
  pairs: Record<string, string>
  /** New slots nothing paired with: the holes to fill. */
  unmatchedTo: string[]
  /** Old slots nothing paired with: content with nowhere to go. */
  unmatchedFrom: string[]
}

/**
 * Pairs the boxes of `from` with the boxes of `to`.
 *
 * Name first, then kind-and-tier in declaration order. Order rather than
 * geometry is the tiebreak for two boxes of the same tier deliberately: the
 * server has no geometry to measure, and a pairing the client and server
 * disagree about is worse than one that is merely arbitrary. Declaration
 * order is also reading order in every layout that flows.
 */
export const pairSlots = (
  from: Pick<Layout, 'slots' | 'tree' | 'elementPositions'>,
  to: Pick<Layout, 'slots' | 'tree' | 'elementPositions'>,
): SlotPairing => {
  const fromSlots = tieredSlots(from)
  const toSlots = tieredSlots(to)
  const toNames = new Set(toSlots.map(s => s.name))

  const pairs: Record<string, string> = {}
  const takenTo = new Set<string>()

  // 1. The same name in both layouts is the same box — as long as it still
  //    holds the same kind of thing. A layout that reuses a name for another
  //    medium (`body` as a paragraph here, as a list there) is not carrying
  //    the box over, and pretending otherwise puts a value in a box no
  //    editor for that kind can show.
  const byName = new Map(toSlots.map(s => [s.name, s]))
  for (const slot of fromSlots) {
    const sameName = toNames.has(slot.name) ? byName.get(slot.name) : undefined
    if (sameName && sameName.kind === slot.kind) {
      pairs[slot.name] = slot.name
      takenTo.add(slot.name)
    }
  }

  // 2. What is left pairs on kind and tier, first-come in declaration order.
  const openTo = toSlots.filter(s => !takenTo.has(s.name))
  for (const slot of fromSlots) {
    if (pairs[slot.name]) continue
    const match = openTo.find(
      candidate =>
        !takenTo.has(candidate.name) &&
        candidate.kind === slot.kind &&
        candidate.tier === slot.tier,
    )
    if (!match) continue
    pairs[slot.name] = match.name
    takenTo.add(match.name)
  }

  return {
    pairs,
    unmatchedTo: toSlots.filter(s => !takenTo.has(s.name)).map(s => s.name),
    unmatchedFrom: fromSlots.filter(s => !pairs[s.name]).map(s => s.name),
  }
}
