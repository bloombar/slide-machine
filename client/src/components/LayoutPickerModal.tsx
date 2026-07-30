/**
 * Per-slide layout picker (EDIT-3): the deck template's layouts as a
 * card grid, current one highlighted; picking dispatches
 * slide.setLayout and closes. Escape or the backdrop closes without
 * changing anything.
 */
import { useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { Template } from '@slide-machine/shared'
import Modal from './Modal'

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
              values={{ name: template.name }}
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
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {template.layouts.map(layout => {
          const selected = layout.type === current
          return (
            <button
              key={layout.type}
              role="radio"
              aria-checked={selected}
              onClick={() => onPick(layout.type)}
              className={`rounded-md border px-4 py-3 text-start ${
                selected
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className="block text-sm font-medium">{layout.label}</span>
              <span className="block text-xs text-slate-500">
                {layout.purpose}
              </span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
