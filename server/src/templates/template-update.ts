/**
 * Offering a template update to a lecture that pinned an older one (TMPL-11).
 *
 * A deck holds the structure it was built against, so an edit to its template
 * is an offer rather than an event: the owner is told the design moved on, and
 * decides when to take it. This module answers the two questions that flow
 * needs — "has it moved, and what would it cost?" and "where does each box's
 * content go if I say yes?" — from one pairing, so the warning shown and the
 * move performed can never disagree.
 *
 * The pairing is `pairSlots`, the same one behind a per-slide layout switch
 * and the transition animation. A box keeps its content when the updated
 * layout still declares its name, or failing that a box of the same kind and
 * tier; what pairs with nothing is what the owner is warned about.
 */
import { pairSlots } from '@slide-machine/shared'
import type {
  Layout,
  SlotValue,
  Template,
  TemplateUpdateImpact,
  TemplateUpdateStatus,
  TemplateVersion,
} from '@slide-machine/shared'
import { resolveTemplate } from './resolve'
import {
  contentHashOf,
  getVersion,
  type DeckTemplate,
  type PinnableDeck,
} from './versions'

/** A slide, as the update needs to see one. */
export interface UpdatableSlide {
  id: string
  layoutType: string
  slots: Record<string, SlotValue>
}

/** True when a box actually holds something a user would miss. */
export const slotHasContent = (value: SlotValue | undefined): boolean => {
  if (!value) return false
  switch (value.kind) {
    case 'text':
    case 'preformatted':
      return value.value.trim().length > 0
    case 'bullets':
      return value.items.some(item => item.trim().length > 0)
    case 'image':
      return Boolean(value.ref)
    case 'code':
      return value.source.trim().length > 0
    case 'math':
      return value.tex.trim().length > 0
    case 'table':
      return value.rows.some(row => row.some(cell => cell.trim().length > 0))
  }
}

/** How one layout's boxes move when the update is applied. */
export interface LayoutPlan {
  /** Old box → new box, for every box that found a partner. */
  pairs: Record<string, string>
  /** Boxes with nowhere to go in the updated layout. */
  unmatchedFrom: string[]
  /** True when the updated template no longer declares this layout at all. */
  layoutRemoved: boolean
}

/**
 * The move for every layout the deck uses, keyed by layout type.
 *
 * Computed against the layouts as the deck currently sees them (`from`) and
 * as the template now defines them (`to`) — never against a third state, so
 * the plan a user is shown is the plan that runs.
 */
export const planUpdate = (
  from: Pick<DeckTemplate, 'layouts'>,
  to: Pick<DeckTemplate, 'layouts'>,
  usedLayoutTypes: Iterable<string>,
): Map<string, LayoutPlan> => {
  const plans = new Map<string, LayoutPlan>()
  const byType = (layouts: Layout[], type: string): Layout | undefined =>
    layouts.find(l => l.type === type)
  for (const type of usedLayoutTypes) {
    const fromLayout = byType(from.layouts, type)
    if (!fromLayout) continue
    const toLayout = byType(to.layouts, type)
    if (!toLayout) {
      plans.set(type, { pairs: {}, unmatchedFrom: [], layoutRemoved: true })
      continue
    }
    const { pairs, unmatchedFrom } = pairSlots(fromLayout, toLayout)
    plans.set(type, { pairs, unmatchedFrom, layoutRemoved: false })
  }
  return plans
}

/** Where one slide lands when the lecture moves to a different design. */
export interface SwitchPlan {
  /** The layout in the new template that carries this slide. */
  layoutType: string
  /** Old box → new box, for every box that found a partner. */
  pairs: Record<string, string>
  /** Boxes with nowhere to go, left where they are for a later re-fit. */
  unmatchedFrom: string[]
}

/**
 * Where a slide's content goes when the lecture is moved to ANOTHER template
 * (TMPL-8): an imported design applied to a lecture that already has slides.
 *
 * The difference from `planUpdate` is only which layouts are being compared.
 * An update matches a layout to the same layout a version later, so the type
 * is the key. A switch has no such correspondence: an imported design names
 * its layouts whatever its slides turned out to be, and a lecture full of
 * `content` slides moving to it would otherwise sit on a layout the new
 * template has never heard of, showing nothing.
 *
 * So the target layout is CHOSEN, by the same pairing that carries content
 * everywhere else in this system:
 *
 *   1. A layout of the same type, when the new design happens to have one —
 *      two templates that both name a layout `content` mean the same thing
 *      by it.
 *   2. Otherwise the layout that carries the most of what the slide actually
 *      holds. Empty boxes do not vote: a slide with a title and nothing else
 *      belongs on a title card, not on the layout with the most boxes.
 *
 * Ties break toward the layout that leaves fewest boxes empty, then toward
 * declaration order — the design's own idea of which layout is its ordinary
 * one. Nothing is deleted: what pairs with nothing stays on the slide, so a
 * switch costs content that needs re-placing rather than content that is gone.
 */
export const planTemplateSwitch = (
  from: Pick<DeckTemplate, 'layouts'>,
  to: Pick<DeckTemplate, 'layouts'>,
  slides: UpdatableSlide[],
): Map<string, SwitchPlan> => {
  const plans = new Map<string, SwitchPlan>()
  if (!to.layouts.length) return plans

  for (const slide of slides) {
    const fromLayout = from.layouts.find(l => l.type === slide.layoutType)
    // A layout the old design never declared, or one with no boxes at all —
    // a freehand whiteboard canvas is the real case. Either way there is
    // nothing to pair, so any layout this chose would be a guess on no
    // evidence. The slide keeps what it has.
    if (!fromLayout?.slots.length) continue

    const filled = new Set(
      Object.keys(slide.slots).filter(name =>
        slotHasContent(slide.slots[name]),
      ),
    )
    const sameType = to.layouts.find(l => l.type === slide.layoutType)
    const candidates = sameType ? [sameType] : to.layouts

    let best: (SwitchPlan & { carried: number; holes: number }) | undefined
    for (const candidate of candidates) {
      const { pairs, unmatchedFrom, unmatchedTo } = pairSlots(
        fromLayout,
        candidate,
      )
      const carried = Object.keys(pairs).filter(name => filled.has(name)).length
      const holes = unmatchedTo.length
      const better =
        !best ||
        carried > best.carried ||
        (carried === best.carried && holes < best.holes)
      if (better) {
        best = {
          layoutType: candidate.type,
          pairs,
          unmatchedFrom,
          carried,
          holes,
        }
      }
    }
    if (!best) continue
    const { carried: _carried, holes: _holes, ...plan } = best
    plans.set(slide.id, plan)
  }
  return plans
}

/** The label an author would recognize for a box, falling back to its name. */
const labelFor = (layout: Layout | undefined, slot: string): string =>
  layout?.slots.find(s => s.name === slot)?.label ?? slot

/**
 * Whether the deck's template has moved on, and what taking it would cost.
 *
 * Reports only what the deck would actually notice: layouts none of its
 * slides use are ignored however much they changed, and a box that pairs with
 * nothing is only counted when a slide really has something in it. A purely
 * cosmetic edit therefore shows as "available, nothing to adjust", which is
 * both true and the common case.
 */
export const templateUpdateStatus = async (
  deck: PinnableDeck,
  slides: UpdatableSlide[],
): Promise<TemplateUpdateStatus> => {
  const none: TemplateUpdateStatus = {
    available: false,
    impact: [],
    affectedSlides: 0,
  }
  const pinned = await getVersion(deck.templateVersionId ?? undefined)
  // A lecture that predates versions follows its template live, so there is
  // nothing to offer it until something pins it.
  if (!pinned) return none
  const live = await resolveTemplate(deck.templateId)
  // The template is gone (or tombstoned). The deck keeps rendering from its
  // pinned version, and there is no newer structure to move to.
  if (!live) return none
  if (contentHashOf(live) === pinned.contentHash) return none

  const used = new Set(slides.map(s => s.layoutType))
  const plans = planUpdate(pinned, live, used)

  const impact: TemplateUpdateImpact[] = []
  const affected = new Set<string>()
  for (const [layoutType, plan] of plans) {
    const on = slides.filter(s => s.layoutType === layoutType)
    if (plan.layoutRemoved) {
      on.forEach(s => affected.add(s.id))
      impact.push({
        layoutType,
        slideCount: on.length,
        unplaced: [],
        layoutRemoved: true,
      })
      continue
    }
    // Only boxes that some slide actually fills: an empty box going away
    // costs nobody anything and should not be warned about.
    const losing = plan.unmatchedFrom.filter(name =>
      on.some(slide => slotHasContent(slide.slots[name])),
    )
    if (!losing.length) continue
    on.forEach(slide => {
      if (losing.some(name => slotHasContent(slide.slots[name])))
        affected.add(slide.id)
    })
    const fromLayout = pinned.layouts.find(l => l.type === layoutType)
    impact.push({
      layoutType,
      slideCount: on.length,
      unplaced: losing.map(name => labelFor(fromLayout, name)),
      layoutRemoved: false,
    })
  }

  return { available: true, impact, affectedSlides: affected.size }
}

/** The live template a deck would update to, when one is on offer. */
export const pendingTemplateFor = async (
  deck: PinnableDeck,
  pinned: TemplateVersion,
): Promise<Template | undefined> => {
  const live = await resolveTemplate(deck.templateId)
  if (!live || contentHashOf(live) === pinned.contentHash) return undefined
  return live
}
