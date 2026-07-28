/**
 * Lecture settings as a full-width modal over the viewer, divided into
 * tabs: General (seed notes + document uploads), Design
 * (EDIT-2 via deck.switchTemplate), and Privacy & Sharing (SHARE-1
 * access controls). All changes save immediately. Closes from the
 * top-right icon or the Escape key; Left/Right arrows move between
 * tabs when the tab list has focus.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Download, X } from 'lucide-react'
import {
  findTtsVoice,
  type Deck,
  type ExportDownload,
  type DeckRefineResult,
  type DeckRefineStatusResult,
  type DeckSetRefineSettingsInput,
  type RefineJobSummary,
  type SlideRefineParts,
  type Template,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { downloadExport } from '../lib/download'
import TemplatePicker from './TemplatePicker'
import AccessSettings from './AccessSettings'
import QuizPanel from './QuizPanel'
import ExportPanel from './ExportPanel'
import SeedNotesEditor from './SeedNotesEditor'
import SeedMaterial from './SeedMaterial'
import FreedomSlider from './FreedomSlider'
import LanguageSelect from './LanguageSelect'
import VoiceSelect from './VoiceSelect'
import ConfirmDialog from './ConfirmDialog'
import Modal from './Modal'
import {
  RefineLevelSlider,
  RefineOption,
  RefinePartsOptions,
} from './refine/RefineControls'
import { getTtsEnabled, getRefineSlidesDefaultLevel } from '../runtime-config'
import { lectureTitle } from '../lib/lecture'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'template', label: 'Design' },
  { id: 'refine', label: 'Refine with AI' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'export', label: 'Export' },
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
  /** True when any slide carries whiteboard marks — refining slides then
   * prompts a confirmation, since it may reflow content under the marks. */
  slidesHaveDrawings?: boolean
  onClose: () => void
  /** Fired after a successful save so the viewer re-themes immediately. */
  onTemplateChange: (deck: Deck, template: Template) => void
  /** Fired after any deck-level save so the viewer keeps a fresh deck. */
  onDeckChange: (deck: Deck) => void
  /** Fired after the lecture is deleted; the viewer leaves the page. */
  onDeleted: () => void
  /** Fired after a reformat so the viewer reloads its (now-revised) slides. */
  onReformatted: () => void
}

export default function DeckSettingsModal({
  deck,
  projectGenerationFreedom,
  projectTtsVoice,
  initialTab = 'general',
  isOwner,
  slidesHaveDrawings = false,
  onClose,
  onTemplateChange,
  onDeckChange,
  onDeleted,
  onReformatted,
}: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [tab, setTab] = useState<TabId>(initialTab)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Post-lecture refinement (GEN-4): any of three passes, run as one job.
  // Every setting persists to the lecture so the single-slide "Refine this
  // slide" kebab action reuses the same choices. Toggles start from the
  // lecture's saved value, else the default (all on; speaker ID only when
  // there is audio to diarize, and it is disabled otherwise). Slider levels
  // start at the lecture's own value if set, else the server default.
  const [identifySpeakers, setIdentifySpeakers] = useState(
    deck.refineIdentifySpeakers ?? deck.hasRecordings ?? false,
  )
  // A google-cloud recording's audio can finish flushing after this modal is
  // already open (the viewer polls for it). When the lecture first reports
  // recordings, the speaker-ID toggle was disabled — so the user couldn't have
  // set it — so re-derive its default now (enable + check unless the lecture
  // explicitly saved it off), matching what a reload would show.
  const hadRecordingsRef = useRef(deck.hasRecordings ?? false)
  useEffect(() => {
    if (deck.hasRecordings && !hadRecordingsRef.current) {
      setIdentifySpeakers(deck.refineIdentifySpeakers ?? true)
    }
    hadRecordingsRef.current = deck.hasRecordings ?? false
  }, [deck.hasRecordings, deck.refineIdentifySpeakers])
  // Which aspects of each slide the content pass may change. The lecture
  // stores one flag for the pass as a whole, so the three boxes start together
  // from it (all on unless the lecture saved the pass off) and their combined
  // state is what gets saved back; the split itself is per run, exactly as in
  // the per-slide dialog.
  const [parts, setParts] = useState<Required<SlideRefineParts>>(() => {
    const on = deck.refineSlidesEnabled ?? true
    return { text: on, layout: on, imagery: on }
  })
  const refineSlides = Object.values(parts).some(Boolean)
  const [refineTranscript, setRefineTranscript] = useState(
    deck.refineTranscriptEnabled ?? false,
  )
  // One strength for everything this run refines, like the per-slide dialog.
  const [level, setLevel] = useState(
    deck.refineSlidesLevel ??
      deck.refineTranscriptLevel ??
      getRefineSlidesDefaultLevel(),
  )
  const [refining, setRefining] = useState(false)
  const [refineMsg, setRefineMsg] = useState<string | null>(null)
  // Confirm before refining slides that carry whiteboard marks (WB-1).
  const [confirmingRefine, setConfirmingRefine] = useState(false)
  const anySelected = identifySpeakers || refineSlides || refineTranscript
  // Nothing to refine when the lecture has no slides — disable the whole form.
  const hasSlides = (deck.slideOrder?.length ?? 0) > 0

  // Editable lecture title. Saving a non-empty title locks out AI titling
  // (deck.rename does this server-side); clearing it hands naming back to
  // the AI. Only saved when it actually changed.
  const [titleDraft, setTitleDraft] = useState(deck.title)
  const saveTitle = () => {
    if (titleDraft.trim() === deck.title.trim()) return
    dispatchAction<Deck>('deck.rename', {
      deckId: deck.id,
      title: titleDraft.trim(),
    })
      .then(onDeckChange)
      .catch(() => {
        // Quiet failure: the field reverts to the saved title on re-render
      })
  }

  // Persist changed Refine settings to the lecture. Toggles save immediately;
  // a dragged slider is debounced (it fires many changes). An untouched slider
  // is never saved, so it keeps inheriting the server default.
  const saveRefineSettings = (patch: Partial<DeckSetRefineSettingsInput>) => {
    dispatchAction<Deck>('deck.setRefineSettings', {
      deckId: deck.id,
      ...patch,
    })
      .then(onDeckChange)
      .catch(() => {
        // Quiet failure: the setting reverts on the next reload
      })
  }
  // One slider now drives both passes, so it saves to both stored levels —
  // which keeps the per-slide dialog and the transcript editor (each reading
  // one of them) in step with what was chosen here.
  const persistTimer = useRef<number | undefined>(undefined)
  const persistLevel = (next: number) => {
    window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(
      () => saveRefineSettings({ slidesLevel: next, transcriptLevel: next }),
      500,
    )
  }
  useEffect(() => () => window.clearTimeout(persistTimer.current), [])
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

  // Export the lecture's current template as a re-importable YAML file (EXP-2).
  const exportTemplate = () => {
    dispatchAction<ExportDownload>('template.export', {
      templateId: deck.templateId,
    })
      .then(downloadExport)
      .catch(() => {
        // Quiet failure: nothing downloads
      })
  }

  /** Human summary of what a finished refine job changed. */
  const summaryMessage = (s: RefineJobSummary): string => {
    const parts: string[] = []
    if (s.reframed)
      parts.push(
        `reframed ${s.reframed} student slide${s.reframed === 1 ? '' : 's'}`,
      )
    if (s.slidesRefined)
      parts.push(
        `refined ${s.slidesRefined} slide${s.slidesRefined === 1 ? '' : 's'}`,
      )
    if (s.transcriptsUpdated)
      parts.push(
        `updated ${s.transcriptsUpdated} narration${s.transcriptsUpdated === 1 ? '' : 's'}`,
      )
    return parts.length
      ? `Done — ${parts.join(', ')}.`
      : 'Done — no changes were needed.'
  }

  /** Polls the job until it leaves 'running' (batch diarization can take
   * minutes); returns the summary, or throws on error/timeout. */
  const pollRefine = async (jobId: string): Promise<RefineJobSummary> => {
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const res = await dispatchAction<DeckRefineStatusResult>(
        'deck.refineStatus',
        { jobId },
      )
      if (res.status === 'done')
        return (
          res.summary ?? {
            reframed: 0,
            slidesRefined: 0,
            transcriptsUpdated: 0,
          }
        )
      if (res.status === 'error') throw new Error(res.error ?? 'refine failed')
    }
    throw new Error('refine timed out')
  }

  /** Starts the selected refinement passes as one background job, then reloads
   * the viewer's slides when it finishes. */
  const runRefine = async () => {
    setRefining(true)
    setRefineMsg(null)
    try {
      const { jobId } = await dispatchAction<DeckRefineResult>('deck.refine', {
        deckId: deck.id,
        ...(identifySpeakers ? { identifySpeakers: true } : {}),
        ...(refineSlides ? { refineSlides: { level, parts } } : {}),
        ...(refineTranscript ? { refineTranscript: { level } } : {}),
      })
      const summary = await pollRefine(jobId)
      setRefineMsg(summaryMessage(summary))
      onReformatted()
    } catch {
      setRefineMsg('Could not complete the refinement — please try again.')
    } finally {
      setRefining(false)
    }
  }

  /** Refine button: warn first when the slide pass would run over marked-up
   * slides (it may reflow content under the annotations); else refine now. */
  const onRefineClick = () => {
    if (refineSlides && slidesHaveDrawings) {
      setConfirmingRefine(true)
    } else {
      void runRefine()
    }
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
              Lecture title
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              Name this lecture. Leave it blank to let the AI title it from your
              speech as the lecture unfolds.
            </p>
            <input
              aria-label="Lecture title"
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              placeholder="Untitled lecture"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
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

      {confirmingRefine && (
        <ConfirmDialog
          title="Refine marked-up slides?"
          message="Some slides have whiteboard markings. Refining may change their content or layout, so highlights and annotations may no longer line up with what's underneath."
          confirmLabel="Refine anyway"
          onConfirm={() => {
            setConfirmingRefine(false)
            void runRefine()
          }}
          onCancel={() => setConfirmingRefine(false)}
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
          <div className="mt-6 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={exportTemplate}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" aria-hidden />
              Export template as YAML
            </button>
            <p className="mt-1 text-xs text-slate-500">
              Download this template’s style and layouts as a re-importable YAML
              file.
            </p>
          </div>
        </section>
      )}

      {tab === 'refine' && (
        <section
          role="tabpanel"
          id="settings-panel-refine"
          aria-labelledby="settings-tab-refine"
          className="flex flex-col gap-6"
        >
          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              Refine this lecture
            </h3>
            <p className="text-sm text-slate-500">
              Improve the text, images, and spoken version of the slides. This
              can take a few minutes and runs in the background.
            </p>
            {!hasSlides && (
              <p className="mt-2 text-sm text-amber-600">
                This lecture has no slides yet, so there is nothing to refine.
              </p>
            )}
          </div>

          <fieldset disabled={!hasSlides} className="flex flex-col gap-5">
            <div>
              <RefineOption
                label="Identify multiple speakers"
                description={
                  <>
                    Detect who spoke — you versus students — and reframe student
                    turns as questions, not fact.
                    {!deck.hasRecordings &&
                      ' (No lecture audio was recorded, so this is unavailable.)'}
                  </>
                }
                checked={identifySpeakers}
                disabled={!deck.hasRecordings}
                onChange={checked => {
                  setIdentifySpeakers(checked)
                  saveRefineSettings({ identifySpeakers: checked })
                }}
              />
            </div>

            <RefinePartsOptions
              value={parts}
              onChange={next => {
                setParts(next)
                // The lecture stores the pass as one flag: on while any aspect
                // of a slide is still being refined.
                saveRefineSettings({
                  slidesEnabled: Object.values(next).some(Boolean),
                })
              }}
            />

            <RefineOption
              label="Refine the spoken transcript"
              description="Rewrite the read-aloud narration to describe the concepts more eloquently."
              checked={refineTranscript}
              onChange={checked => {
                setRefineTranscript(checked)
                saveRefineSettings({ transcriptEnabled: checked })
              }}
            />

            <RefineLevelSlider
              value={level}
              ariaLabel="How much to refine this lecture"
              onChange={v => {
                setLevel(v)
                persistLevel(v)
              }}
            />
          </fieldset>

          <div>
            <button
              onClick={onRefineClick}
              disabled={refining || !anySelected || !hasSlides}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {refining ? 'Refining…' : 'Refine'}
            </button>
            {refining && (
              <p className="mt-3 text-sm text-slate-500">
                Working in the background — this can take a few minutes.
              </p>
            )}
            {refineMsg && (
              <p role="status" className="mt-3 text-sm text-slate-700">
                {refineMsg}
              </p>
            )}
          </div>
        </section>
      )}

      {tab === 'quiz' && (
        <section
          role="tabpanel"
          id="settings-panel-quiz"
          aria-labelledby="settings-tab-quiz"
        >
          <QuizPanel deckId={deck.id} />
        </section>
      )}

      {tab === 'export' && (
        <section
          role="tabpanel"
          id="settings-panel-export"
          aria-labelledby="settings-tab-export"
        >
          <ExportPanel deckId={deck.id} />
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
