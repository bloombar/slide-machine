/**
 * Whether a slot has anything to show on a given slide.
 *
 * Renderers use this to decide whether to draw a slot at all: an empty
 * caption should take no space, or a container's gap would reserve a hole
 * where nothing is. In the editor the answer is ignored — an empty slot stays
 * on screen as somewhere to click, so a layout switch never strands content
 * the user cannot reach.
 *
 * Built on `slotValue` rather than reading `slide.slots` directly, so a slide
 * saved before content moved into the slot map answers the same way.
 */
import type { Slide, SlotKind } from '@slide-machine/shared'
import { slotValue } from '../slots'

export const slotIsEmpty = (slide: Slide, name: string): boolean => {
  const value = slotValue(slide, name)
  if (value.imageRef) return false
  if (value.bullets?.length) return false
  if (value.text?.trim()) return false
  return true
}

/**
 * Whether a renderer should draw a slot at all.
 *
 * Three reasons to keep an empty one: the author is editing and needs
 * somewhere to click, or a picture is still being found for it (GEN-5) and
 * its loading skeleton needs a place to be.
 */
export const slotIsShown = (
  slide: Slide,
  name: string,
  opts: { kind?: SlotKind; editable?: boolean; imagePending?: boolean } = {},
): boolean => {
  if (opts.editable) return true
  if (opts.imagePending && opts.kind === 'image') return true
  return !slotIsEmpty(slide, name)
}
