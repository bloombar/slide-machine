/**
 * A miniature slide in a template's own theme and layout (TMPL-1). The point
 * of a library is to show what a template *looks* like, so this renders the
 * real slide renderer rather than an approximation of it — the same
 * components, theme resolution and container-query scaling the viewer uses.
 * Anything that changes how slides look changes the preview with it.
 *
 * The sample content is translated, not lorem ipsum: a preview should read as
 * a slide in the reader's language.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Slide, Template } from '@slide-machine/shared'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import SlideView from '../SlideView'
import { themeColors } from '../slide/theme'

/** The layout to show, preferring one that exercises the theme: a title-and-
 * body slide says more about a template than an empty section heading, and
 * the whiteboard is a blank slate that says nothing at all. */
const previewLayout = (
  template: Template,
): Template['layouts'][number] | undefined => {
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
  className = '',
}: {
  template: Template
  className?: string
}) {
  const { t } = useTranslation()
  const layout = previewLayout(template)

  // Every slot the layout declares is filled, and nothing else: a preview
  // showing content in a slot the layout has no room for would misrepresent
  // it. A slot the author named gets its own label as sample text, so a
  // custom layout previews as itself rather than as a blank.
  const slide = useMemo<Slide | undefined>(() => {
    if (!layout) return undefined
    const sample: Record<string, string> = {
      title: t('template.preview.title'),
      body: t('template.preview.body'),
      caption: t('template.preview.caption'),
    }
    const slots: Slide['slots'] = {}
    for (const spec of layout.slots) {
      if (spec.kind === 'bullets') {
        slots[spec.name] = {
          kind: 'bullets',
          items: [
            t('template.preview.bullet1'),
            t('template.preview.bullet2'),
            t('template.preview.bullet3'),
          ],
        }
      } else if (spec.kind === 'text') {
        slots[spec.name] = {
          kind: 'text',
          value: sample[spec.name] ?? spec.label,
        }
      }
      // Image slots stay empty: the renderer's quiet reserved block is what
      // a picture-shaped hole looks like, and a preview must not fetch one.
    }
    return {
      id: `preview-${template.id}`,
      deckId: 'preview',
      index: 0,
      layoutType: layout.type,
      slots,
    }
  }, [layout, template.id, t])

  // A template with no layouts has nothing to show; render its background so
  // the card still reads as that template rather than as a broken tile.
  if (!slide) {
    return (
      <div className={className} aria-hidden>
        <div
          data-testid="template-preview"
          className="aspect-video w-full rounded-xl"
          style={{ backgroundColor: themeColors(template.theme).background }}
        />
      </div>
    )
  }

  return (
    <div className={className} aria-hidden>
      <SlideView slide={slide} template={template} testId="template-preview" />
    </div>
  )
}
