/**
 * A slide in a template's own theme and layout (TMPL-1). The point of a
 * library is to show what a template *looks* like, so this renders the real
 * slide renderer rather than an approximation of it — the same components,
 * theme resolution and container-query scaling the viewer uses. Anything that
 * changes how slides look changes the preview with it.
 *
 * The sample content is translated, not lorem ipsum: a preview should read as
 * a slide in the reader's language.
 *
 * Two callers, and the difference is `interactive`. The library shows a
 * thumbnail nobody touches, so it is hidden from assistive technology as
 * decoration. The editor's canvas is the thing being worked on, so it is not.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Layout, Template } from '@slide-machine/shared'
import { WHITEBOARD_LAYOUT_TYPE, slotLimits } from '@slide-machine/shared'
import SlideView from '../SlideView'
import { themeColors, themeTextStyles } from '../slide/theme'
import { sampleSlide } from './sampleSlide'

/** The layout to show when the caller has no opinion, preferring one that
 * exercises the theme: a title-and-body slide says more about a template than
 * an empty section heading, and the whiteboard is a blank slate that says
 * nothing at all. */
const previewLayout = (template: Template): Layout | undefined => {
  const layouts = template.layouts ?? []
  const usable = layouts.filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)
  const preferred = ['content', 'list', 'two-column', 'title']
  for (const type of preferred) {
    const match = usable.find(l => l.type === type)
    if (match) return match
  }
  return usable[0] ?? layouts[0]
}

export default function TemplatePreview({
  template,
  layout,
  images,
  interactive,
  atCapacity,
  className = '',
  testId = 'template-preview',
}: {
  template: Template
  /** Which layout to draw. Without one, the most telling is chosen. */
  layout?: Layout
  /** Pictures to fill image slots with, so a layout with a picture in it
   * previews as one. */
  images?: string[]
  /** True in the editor, where the preview is the thing being edited rather
   * than a thumbnail of it. */
  interactive?: boolean
  /** Fills every bounded box with the most it may ever hold, rather than with
   * a comfortable sample — the case a design has to survive. */
  atCapacity?: boolean
  className?: string
  testId?: string
}) {
  const { t } = useTranslation()
  const shown = layout ?? previewLayout(template)

  // The limits are the template's own, so they follow a text style being
  // retuned in the editor as much as a box's limit being typed in.
  const budgets = useMemo(
    () =>
      shown && atCapacity
        ? slotLimits(shown, themeTextStyles(template.theme))
        : undefined,
    [shown, atCapacity, template.theme],
  )

  /**
   * Where this layout starts in the shared run of pictures.
   *
   * Every layout began at the first one, so tab two showed tab one's
   * photographs again: distinct within a slide, and the same few across the
   * whole design. Counting the picture boxes that come before this layout
   * carries the run on instead, so a template is as varied as its pool
   * allows.
   *
   * By position in the template, so it is the same on every render and a
   * layout does not change its pictures when something unrelated does.
   */
  const imageStart = useMemo(() => {
    if (!shown) return 0
    const layouts = template.layouts ?? []
    const at = layouts.indexOf(shown)
    const index = at >= 0 ? at : layouts.findIndex(l => l.type === shown.type)
    if (index <= 0) return 0
    return layouts
      .slice(0, index)
      .reduce(
        (n, l) => n + l.slots.filter(spec => spec.kind === 'image').length,
        0,
      )
  }, [template.layouts, shown])

  const slide = useMemo(
    () =>
      shown &&
      sampleSlide(
        shown,
        {
          title: t('template.preview.title'),
          body: t('template.preview.body'),
          caption: t('template.preview.caption'),
          bullets: [
            t('template.preview.bullet1'),
            t('template.preview.bullet2'),
            t('template.preview.bullet3'),
          ],
        },
        images,
        template.id,
        budgets,
        imageStart,
      ),
    [shown, images, template.id, budgets, imageStart, t],
  )

  // A template with no layouts has nothing to show; render its background so
  // the card still reads as that template rather than as a broken tile.
  if (!slide) {
    return (
      <div className={className} aria-hidden={!interactive}>
        <div
          data-testid={testId}
          className="aspect-video w-full rounded-xl"
          style={{ backgroundColor: themeColors(template.theme).background }}
        />
      </div>
    )
  }

  return (
    <div className={className} aria-hidden={!interactive}>
      <SlideView slide={slide} template={template} testId={testId} />
    </div>
  )
}
