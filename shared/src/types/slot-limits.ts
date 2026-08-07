/**
 * The most each of a layout's boxes may hold.
 *
 * Shared because three readers must agree on it: the editor's preview fills
 * every box to its limit, the prompt tells the model what fits, and the
 * server trims what comes back. If they resolved limits differently, a
 * template would preview at one capacity and generate at another.
 *
 * One precedence, everywhere:
 *
 *   1. the box's own limit — the most specific thing anyone can say;
 *   2. the text style the box is set in — the template-wide default the
 *      editor's "Default text styles" edits;
 *   3. the layout's constraint for that conventional slot — the coarsest,
 *      and the only one no editor exposes, so it yields to the style rather
 *      than overriding it.
 *
 * A box no rule reaches has no limit at all, and is left out.
 */
import type { Layout, SlotSpec } from './template'
import { textStylesBySlot } from './slot-pairing'
import type { ThemeTextStyles } from './text-styles'

/** What one box may hold: characters of text, and for a list, points. */
export interface SlotLimits {
  maxChars?: number
  maxItems?: number
}

/** The parts of a layout the limits are read from. */
type LimitedLayout = Pick<
  Layout,
  'slots' | 'constraints' | 'tree' | 'elementPositions'
>

/** Every bounded box of a layout, keyed by slot name. Pictures hold no text,
 * so nothing bounds them and they never appear. */
export const slotLimits = (
  layout: LimitedLayout,
  textStyles: ThemeTextStyles,
): Record<string, SlotLimits> => {
  const roles = textStylesBySlot(layout)
  const out: Record<string, SlotLimits> = {}
  for (const spec of layout.slots ?? []) {
    if (spec.kind === 'image') continue
    const limits = limitsFor(spec, layout, textStyles, roles[spec.name])
    if (limits.maxChars !== undefined || limits.maxItems !== undefined) {
      out[spec.name] = limits
    }
  }
  return out
}

/** One box's limits, for a caller that already knows its style. */
export const limitsFor = (
  spec: Pick<SlotSpec, 'name' | 'kind' | 'maxChars' | 'maxItems'>,
  layout: Pick<Layout, 'constraints'>,
  textStyles: ThemeTextStyles,
  role: string | undefined,
): SlotLimits => {
  const c = layout.constraints ?? {}
  // The layout's character constraints are named per conventional slot, so
  // they only reach a box that goes by one of those names.
  const byName: Record<string, number | undefined> = {
    title: c.maxTitleChars,
    body: c.maxBodyChars,
    caption: c.maxCaptionChars,
  }
  const style = role ? textStyles[role] : undefined
  const bullets = spec.kind === 'bullets'
  return {
    maxChars:
      spec.maxChars ??
      style?.maxChars ??
      (bullets ? c.maxBulletChars : byName[spec.name]),
    maxItems: bullets
      ? (spec.maxItems ?? style?.maxItems ?? c.maxBullets)
      : undefined,
  }
}
