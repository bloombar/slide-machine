/**
 * Per-slide layout picker (EDIT-3): the deck template's layouts as a
 * card grid, current one highlighted; picking dispatches
 * slide.setLayout and closes. Escape or the backdrop closes without
 * changing anything.
 *
 * Each card is a miniature slide in the deck's own template, the way the
 * Design tab shows a template: a name and a sentence say what a layout is
 * for, but what a reader wants to know is where the words will land, and
 * that is a thing to be looked at rather than described.
 */
import { useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { Template } from '@slide-machine/shared'
import { templateName } from '../i18n/templateName'
import Modal from './Modal'
import PreviewCard from './template/PreviewCard'

interface Props {
  template: Template
  current: string
  onPick: (layoutType: string) => void
  onClose: () => void
  /** Closes the picker and opens the Design settings tab. */
  onChangeTemplate: () => void
}

export default function LayoutPickerModal({
  template,
  current,
  onPick,
  onClose,
  onChangeTemplate,
}: Props) {
  const { t } = useTranslation()
  const closeRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal
      ariaLabel={t('layout.change')}
      size="lg"
      className="max-h-[80vh] overflow-y-auto"
      onClose={onClose}
      initialFocusRef={closeRef}
    >
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold">{t('layout.change')}</h3>
          <p className="mt-1 text-sm text-slate-500">
            {/* Trans, not t: the template's name is emphasised mid-sentence,
                and where that sits in the sentence varies by language. */}
            <Trans
              i18nKey="layout.fromTemplate"
              values={{ name: templateName(t, template) }}
              components={{ strong: <strong /> }}
            />{' '}
            <button
              onClick={onChangeTemplate}
              className="text-indigo-600 underline hover:text-indigo-800"
            >
              {t('layout.changeTemplate')}
            </button>
          </p>
        </div>
        <button
          ref={closeRef}
          aria-label={t('layout.close')}
          onClick={onClose}
          className="rounded-md p-2 text-slate-500 hover:text-slate-900"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>
      <div
        role="radiogroup"
        aria-label={t('layout.pickerLabel')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        {template.layouts.map(layout => {
          const selected = layout.type === current
          // A layout with no readable name would be an empty button:
          // invisible here, yet still reachable with the "[" and "]" keys,
          // which pick by type. Its type is at least something.
          const label = layout.label.trim() || layout.type
          return (
            <PreviewCard
              key={layout.type}
              template={template}
              layout={layout}
              selected={selected}
              onSelect={() => onPick(layout.type)}
              // Told apart from the Design tab's grid of previews, which
              // shows whole templates rather than one template's layouts.
              testId="layout-preview"
              // No tile round the picture and its words: a wall of slides
              // reads as slides, and the hairline is on the slide itself.
              chrome="bare"
              // A card's own name, for anything that has to find one without
              // reading it off the card: the picture is the first thing in a
              // card's text now, so its name no longer is.
              data={{
                'data-layout-type': layout.type,
                'data-layout-label': label,
              }}
            >
              <span className="block truncate text-sm font-medium">
                {label}
              </span>
              <span className="block text-xs text-slate-500">
                {layout.purpose}
              </span>
            </PreviewCard>
          )
        })}
      </div>
    </Modal>
  )
}
