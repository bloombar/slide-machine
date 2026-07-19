/**
 * Lecture settings as a full-width modal over the viewer, divided into
 * tabs: General (seed notes + document uploads), Design template
 * (EDIT-2 via deck.switchTemplate), and Privacy & Sharing (SHARE-1
 * access controls). All changes save immediately. Closes from the
 * top-right icon or the Escape key; Left/Right arrows move between
 * tabs when the tab list has focus.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { X } from 'lucide-react'
import { findTtsVoice, type Deck, type Template } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import TemplatePicker from './TemplatePicker'
import AccessSettings from './AccessSettings'
import SeedNotesEditor from './SeedNotesEditor'
import SeedMaterial from './SeedMaterial'
import FreedomSlider from './FreedomSlider'
import LanguageSelect from './LanguageSelect'
import VoiceSelect from './VoiceSelect'
import ConfirmDialog from './ConfirmDialog'
import Modal from './Modal'
import { getTtsEnabled } from '../runtime-config'
import { lectureTitle } from '../lib/lecture'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'template', label: 'Design template' },
  { id: 'sharing', label: 'Privacy & Sharing' },
] as const

export type SettingsTabId = (typeof TABS)[number]['id']
type TabId = SettingsTabId

interface Props {
  deck: Deck
  /** The project-level AI freedom this lecture inherits by default. */
  projectGenerationFreedom: number
  /** The project-level narration voice this lecture inherits by default. */
  projectTtsVoice?: string
  /** Which tab opens first (deep links, e.g. Share from a lecture list). */
  initialTab?: TabId
  /** Editors manage access too; only the owner can transfer ownership. */
  isOwner: boolean
  onClose: () => void
  /** Fired after a successful save so the viewer re-themes immediately. */
  onTemplateChange: (deck: Deck, template: Template) => void
  /** Fired after any deck-level save so the viewer keeps a fresh deck. */
  onDeckChange: (deck: Deck) => void
  /** Fired after the lecture is deleted; the viewer leaves the page. */
  onDeleted: () => void
}

export default function DeckSettingsModal({
  deck,
  projectGenerationFreedom,
  projectTtsVoice,
  initialTab = 'general',
  isOwner,
  onClose,
  onTemplateChange,
  onDeckChange,
  onDeleted,
}: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [tab, setTab] = useState<TabId>(initialTab)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>())

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

  const deleteLecture = () => {
    dispatchAction('deck.delete', { deckId: deck.id })
      .then(() => {
        setConfirmingDelete(false)
        onDeleted()
      })
      .catch(() => {
        // Quiet failure: the lecture simply stays
        setConfirmingDelete(false)
      })
  }

  /** Left/Right on the tab list moves and focuses the adjacent tab. */
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const index = TABS.findIndex(t => t.id === tab)
    const next =
      TABS[
        (index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
      ]!
    setTab(next.id)
    tabRefs.current.get(next.id)?.focus()
  }

  return (
    <Modal
      variant="sheet"
      ariaLabel="Lecture settings"
      onClose={onClose}
      initialFocusRef={closeRef}
      escapeCapture={false}
      escapeIgnoreTyping
    >
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Lecture settings</h2>
          <p className="mt-1 text-sm text-slate-500">
            These settings apply to just this lecture. The{' '}
            <Link
              to={`/app/projects/${deck.projectId}`}
              state={{ openSettings: true }}
              className="text-indigo-600 hover:underline"
            >
              project-wide settings
            </Link>{' '}
            may affect this lecture as well.
          </p>
        </div>
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

      <div
        role="tablist"
        aria-label="Settings sections"
        onKeyDown={onTabKeyDown}
        className="mb-6 flex gap-1 border-b border-slate-200"
      >
        {TABS.map(t => (
          <button
            key={t.id}
            ref={el => {
              if (el) tabRefs.current.set(t.id, el)
            }}
            role="tab"
            id={`settings-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`settings-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <section
          role="tabpanel"
          id="settings-panel-general"
          aria-labelledby="settings-tab-general"
          className="flex flex-col gap-8"
        >
          <div>
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
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              Seed material
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              Documents and photos scanned for background text and imagery, used
              by this lecture only.
            </p>
            <SeedMaterial projectId={deck.projectId} deckId={deck.id} />
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              AI freedom
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              How much the AI may add beyond what you actually say while
              generating this lecture&apos;s slides.
            </p>
            <FreedomSlider
              value={deck.generationFreedom}
              inheritedValue={projectGenerationFreedom}
              onChange={freedom => {
                dispatchAction<Deck>('deck.setGenerationFreedom', {
                  deckId: deck.id,
                  freedom,
                })
                  .then(onDeckChange)
                  .catch(() => {
                    // Quiet failure: the slider reverts on rerender
                  })
              }}
            />
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              Language
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              Speech recognition and generated slide text for this lecture.
            </p>
            <LanguageSelect
              value={deck.language}
              defaultLabel="project, profile, or browser setting"
              onChange={language => {
                dispatchAction<Deck>('deck.setLanguage', {
                  deckId: deck.id,
                  language,
                })
                  .then(onDeckChange)
                  .catch(() => {
                    // Quiet failure: the select reverts on rerender
                  })
              }}
            />
          </div>
          {getTtsEnabled() && (
            <div>
              <h3 className="mb-2 text-lg font-semibold text-slate-700">
                Narration voice
              </h3>
              <p className="mb-3 text-sm text-slate-500">
                The voice used to read this lecture aloud. It speaks in the
                lecture&apos;s language.
              </p>
              <VoiceSelect
                value={deck.ttsVoice}
                defaultLabel={
                  findTtsVoice(projectTtsVoice)?.label ?? 'system default'
                }
                onChange={ttsVoice => {
                  dispatchAction<Deck>('deck.setTtsVoice', {
                    deckId: deck.id,
                    voice: ttsVoice,
                  })
                    .then(onDeckChange)
                    .catch(() => {
                      // Quiet failure: the select reverts on rerender
                    })
                }}
              />
            </div>
          )}
          {isOwner && (
            <div className="rounded-md border border-red-200 p-4">
              <h3 className="mb-2 text-lg font-semibold text-red-700">
                Danger zone
              </h3>
              <p className="mb-3 text-sm text-slate-600">
                Deleting a lecture permanently removes its slides and seed
                material. This cannot be undone.
              </p>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Delete lecture
              </button>
            </div>
          )}
        </section>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete lecture?"
          message={`"${lectureTitle(deck)}" and all of its slides and seed material will be permanently deleted.`}
          confirmLabel="Delete"
          onConfirm={deleteLecture}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      {tab === 'template' && (
        <section
          role="tabpanel"
          id="settings-panel-template"
          aria-labelledby="settings-tab-template"
        >
          <h3 className="mb-4 text-lg font-semibold text-slate-700">
            Template
          </h3>
          <TemplatePicker
            templates={templates}
            value={deck.templateId}
            onChange={switchTemplate}
          />
        </section>
      )}

      {tab === 'sharing' && (
        <section
          role="tabpanel"
          id="settings-panel-sharing"
          aria-labelledby="settings-tab-sharing"
        >
          <AccessSettings
            entity="deck"
            subject={{
              id: deck.id,
              name: lectureTitle(deck),
              visibility: deck.visibility,
              accessInherited: deck.accessInherited,
            }}
            isOwner={isOwner}
            onChange={updated => onDeckChange(updated as Deck)}
          />
        </section>
      )}
    </Modal>
  )
}
