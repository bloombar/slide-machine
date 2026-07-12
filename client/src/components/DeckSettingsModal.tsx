/**
 * Lecture settings as a full-width modal over the viewer, organized as
 * sections we add to over time: access control (owners only, SHARE-1)
 * and the style template (EDIT-2 via deck.switchTemplate; changes save
 * immediately). Closes from the top-right icon or the Escape key.
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Deck, Template } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import TemplatePicker from './TemplatePicker'
import DeckAccessSettings from './DeckAccessSettings'
import SeedNotesEditor from './SeedNotesEditor'

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable)

interface Props {
  deck: Deck
  /** Editors manage access too; only the owner can transfer ownership. */
  isOwner: boolean
  onClose: () => void
  /** Fired after a successful save so the viewer re-themes immediately. */
  onTemplateChange: (deck: Deck, template: Template) => void
  /** Fired after any deck-level save so the viewer keeps a fresh deck. */
  onDeckChange: (deck: Deck) => void
}

export default function DeckSettingsModal({
  deck,
  isOwner,
  onClose,
  onTemplateChange,
  onDeckChange,
}: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    dispatchAction<Template[]>('template.list')
      .then(list => {
        if (!cancelled) setTemplates(list)
      })
      .catch(() => {
        // Quiet failure: the section simply stays empty
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Escape closes (unless typing in a field); focus lands on close
  useEffect(() => {
    closeRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isTypingTarget(e.target)) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const switchTemplate = (templateId: string) => {
    dispatchAction<Deck>('deck.switchTemplate', { deckId: deck.id, templateId })
      .then(updated => {
        const template = templates.find(t => t.id === updated.templateId)
        if (template) onTemplateChange(updated, template)
      })
      .catch(() => {
        // Quiet failure: the picker stays on the saved template
      })
  }

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Lecture settings"
        className="fixed inset-x-0 top-14 z-40 max-h-[calc(100vh-3.5rem)] overflow-y-auto border-b border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="mx-auto w-full max-w-5xl">
          <header className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold">Lecture settings</h2>
            <button
              ref={closeRef}
              aria-label="Close settings"
              title="Close (Esc)"
              onClick={onClose}
              className="rounded-md p-2 text-slate-500 hover:text-slate-900"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          <div className="flex flex-col gap-8">
            <section>
              <h3 className="mb-2 text-lg font-semibold text-slate-700">
                Seed notes
              </h3>
              <p className="mb-3 text-sm text-slate-500">
                Lecture-specific background material, added on top of the
                project&apos;s seed notes. Saved automatically.
              </p>
              <SeedNotesEditor
                value={deck.seedContext ?? ''}
                label="Lecture seed notes"
                placeholder="What this lecture covers, key terms, examples…"
                onSave={seedContext => {
                  dispatchAction<Deck>('deck.setSeedNotes', {
                    deckId: deck.id,
                    seedContext,
                  })
                    .then(onDeckChange)
                    .catch(() => {
                      // Quiet failure: the next keystroke retries
                    })
                }}
              />
            </section>

            <DeckAccessSettings
              deck={deck}
              isOwner={isOwner}
              onAccessChange={onDeckChange}
            />
            <section>
              <h3 className="mb-4 text-lg font-semibold text-slate-700">
                Template
              </h3>
              <TemplatePicker
                templates={templates}
                value={deck.templateId}
                onChange={switchTemplate}
              />
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
