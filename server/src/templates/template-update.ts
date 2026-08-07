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
