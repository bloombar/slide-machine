/**
 * One choice in a grid of previews (TMPL-1/EDIT-3): a miniature slide drawn
 * by the real renderer, with a caption under it, as a radio in a radiogroup.
 *
 * Two pickers show the same thing and should look the same doing it — the
 * Design tab choosing a template, and the slide menu choosing a layout within
 * one. Both are "look at it, then click it", so the card they are made of
 * lives here rather than in each of them.
 *
 * The caption is the caller's: a template card names the template, a layout
 * card names the layout and says what it is for.
 */
import { type ReactNode } from 'react'
import type { Layout, Template } from '@slide-machine/shared'
import TemplatePreview from './TemplatePreview'

export default function PreviewCard({
  template,
  layout,
  selected,
  onSelect,
  testId,
  captionClassName = 'block',
  data,
  children,
}: {
  template: Template
  /** Which layout to draw. Without one, the most telling is chosen. */
  layout?: Layout
  selected: boolean
  onSelect: () => void
  /** Overrides the preview's test id, for a grid that has to be told apart
   * from another grid of previews. */
  testId?: string
  /** Classes for the caption row, including how it lays its own contents out
   * — a template's name and badge sit on one line, a layout's name and
   * purpose stack. Replaces the default rather than adding to it, so the two
   * cannot set the display property against each other. */
  captionClassName?: string
  /** Data attributes for the card, so a caller (or a test) can name one
   * without reading the words off it — the picture above the caption is the
   * first thing in a card's text now, so its name is not. */
  data?: Record<string, string>
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      {...data}
      // A column, so the picture stays at the top of a card that a longer
      // caption beside it made taller: a button centres its contents in the
      // space it is given, which left the previews in a row at different
      // heights.
      className={`flex w-full flex-col overflow-hidden rounded-lg border-2 p-1 text-start transition-colors ${
        selected
          ? 'border-indigo-600'
          : 'border-slate-200 hover:border-slate-400'
      }`}
    >
      <TemplatePreview template={template} layout={layout} testId={testId} />
      <span className={`mt-1.5 w-full px-1 pb-0.5 ${captionClassName}`}>
        {children}
      </span>
    </button>
  )
}
