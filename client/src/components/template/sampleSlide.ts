/**
 * The stand-in slide a template preview is drawn with.
 *
 * A layout is easier to judge full than empty, so every slot the layout
 * declares gets something — sample sentences for text, a few points for a
 * bullet list, and a real picture for an image slot, fetched once and shared
 * (usePreviewImages).
 *
 * The text is translated rather than lorem ipsum: a preview should read as a
 * slide in the reader's own language. A slot the author named gets its own
 * label, so a layout of their own previews as itself rather than as a blank.
 */
import type { Layout, Slide } from '@slide-machine/shared'

export interface SampleText {
  title: string
  body: string
  caption: string
  bullets: string[]
}

/**
 * Builds the slide. `images` are cycled across the layout's picture boxes, so
 * a layout with four of them shows four different pictures rather than the
 * same one four times; with none, image slots stay empty and the renderer
 * shows the quiet block it always did.
 */
export const sampleSlide = (
  layout: Layout,
  text: SampleText,
  images: string[] = [],
  id = 'preview',
): Slide => {
  const named: Record<string, string> = {
    title: text.title,
    body: text.body,
    caption: text.caption,
  }
  const slots: Slide['slots'] = {}
  let picture = 0
  for (const spec of layout.slots) {
    if (spec.kind === 'bullets') {
      slots[spec.name] = { kind: 'bullets', items: text.bullets }
    } else if (spec.kind === 'image') {
      const ref = images[picture++ % Math.max(1, images.length)]
      slots[spec.name] = { kind: 'image', ref }
    } else {
      slots[spec.name] = {
        kind: 'text',
        value: named[spec.name] ?? spec.label,
      }
    }
  }
  return {
    id: `preview-${id}`,
    deckId: 'preview',
    index: 0,
    layoutType: layout.type,
    slots,
  }
}
