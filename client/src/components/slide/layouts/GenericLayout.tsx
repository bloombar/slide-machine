/**
 * The last-resort renderer: a layout that says nothing about how it is drawn.
 *
 * Reached when a layout has neither a tree nor geometry — a slide whose
 * layout type this template does not define, or one from a newer server.
 * Stacks whichever conventional slots the slide actually fills: degraded, but
 * never blank.
 *
 * Emptiness is asked of the slot system rather than of the slide's top-level
 * fields, so a slide keeping its content in the slot map reads the same as
 * one saved before that map existed.
 */
import type { LayoutProps } from './types'
import { slotIsShown } from './slotState'

export default function GenericLayout({
  slide,
  colors,
  editable,
  imagePending,
  slot,
}: LayoutProps) {
  const has = (name: string, kind?: 'image') =>
    slotIsShown(slide, name, { kind, editable, imagePending })

  // Resolved up front rather than inside the markup: the calls read as
  // content to the i18n lint rule when they sit in JSX.
  const shows = {
    title: has('title'),
    body: has('body'),
    bullets: has('bullets'),
    image: has('image', 'image'),
    caption: has('caption'),
  }

  // Each box says what it holds, so a slide that falls back to this renderer
  // still animates its boxes into a real layout's boxes (lib/layoutFlip).
  return (
    <div className="flex h-full flex-col justify-center gap-[2cqi] px-[6cqi]">
      {shows.title && (
        <h2
          data-flip-tier="headline"
          className="text-[4cqi] font-semibold"
          style={{ color: colors.accent }}
        >
          {slot('title')}
        </h2>
      )}
      {shows.body && (
        <div data-flip-tier="prose" className="text-[2.75cqi] leading-relaxed">
          {slot('body')}
        </div>
      )}
      {shows.bullets && <div data-flip-tier="list">{slot('bullets')}</div>}
      {shows.image && (
        <div
          data-flip-tier="image"
          className="max-h-[40cqi] overflow-hidden rounded-lg"
        >
          {slot('image')}
        </div>
      )}
      {shows.caption && (
        <p
          data-flip-tier="caption"
          className="text-[2cqi]"
          style={{ color: colors.muted }}
        >
          {slot('caption')}
        </p>
      )}
    </div>
  )
}
