/**
 * Lecture settings as a full-width modal over the viewer, divided into
 * tabs: General (seed notes + document uploads), Design
 * (EDIT-2 via deck.switchTemplate), and Privacy & Sharing (SHARE-1
 * access controls). All changes save immediately. Closes from the
 * top-right icon or the Escape key; Left/Right arrows move between
 * tabs when the tab list has focus.
 *
 * An allowlisted admin opening someone else's lecture edits it here too
 * (ADMIN-5, `adminOverride`): the same controls, saving through the same
 * actions, with a banner and an audit entry per change. What that mode
 * leaves out is everything that is not a settings edit — uploading seed
 * material, running a refine over the owner's slides, and the Quiz and
 * Export tabs, which act through the admin's own Google account.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
import { Download, X } from 'lucide-react'
import {
  findTtsVoice,
  type Deck,
  type ExportDownload,
  type DeckRefineResult,
  type DeckRefineStatusResult,
  type DeckSetRefineSettingsInput,
  type Locale,
  type RefineJobSummary,
  type SlideRefineParts,
  type Template,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { downloadExport } from '../lib/download'
import TemplateDesignPanel from './template/TemplateDesignPanel'
import TemplateUpdateNotice from './template/TemplateUpdateNotice'
import AccessSettings from './AccessSettings'
import QuizPanel from './QuizPanel'
import ExportPanel from './ExportPanel'
import SeedNotesEditor from './SeedNotesEditor'
import SeedMaterial from './SeedMaterial'
import AdminEditNotice from './AdminEditNotice'
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

/** The tabs in order; each id also keys its label under
 * `deck.settings.tabs.<id>` in the locale bundles. */
const TABS = [
  { id: 'general' },
  { id: 'template' },
  { id: 'refine' },
  { id: 'quiz' },
  { id: 'export' },
  { id: 'sharing' },
] as const

export type SettingsTabId = (typeof TABS)[number]['id']
type TabId = SettingsTabId

/** Tabs an admin editing another user's lecture does not get: both act
 * through the admin's own Google account, on the owner's content. */
const ADMIN_HIDDEN_TABS: readonly TabId[] = ['quiz', 'export']

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
  /** True when an admin has opened a lecture they cannot otherwise edit
   * (ADMIN-5): adds the audit banner and drops the sections that change
   * content rather than settings. */
  adminOverride?: boolean
  /** True when any slide carries whiteboard marks — refining slides then
   * prompts a confirmation, since it may reflow content under the marks. */
  slidesHaveDrawings?: boolean
  /** The language the viewer is reading the slides in (SHARE-2), so an
   * export carries what is on screen rather than the authored text. */
  contentLocale?: Locale
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
  adminOverride = false,
  slidesHaveDrawings = false,
  contentLocale,
  onClose,
  onTemplateChange,
  onDeckChange,
  onDeleted,
  onReformatted,
}: Props) {
  const { t } = useTranslation()
  const [templates, setTemplates] = useState<Template[]>([])
  // An admin sees a shorter tab list, so a deep link into one of the
  // hidden tabs lands on General instead.
  const tabs = adminOverride
    ? TABS.filter(t => !ADMIN_HIDDEN_TABS.includes(t.id))
    : TABS
  const [tab, setTab] = useState<TabId>(
    tabs.some(t => t.id === initialTab) ? initialTab : 'general',
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Post-lecture refinement (GEN-4): any of three passes, run as one job.
  // Every setting persists to the lecture so the single-slide "Refine this
  // slide" kebab action reuses the same choices. Toggles start from the
  // lecture's saved value, else the default: the content passes on, speaker ID
  // off. Slider levels start at the lecture's own value if set, else the
  // server default.
  //
  // Speaker ID is the exception because it is the one pass that spends a
  // metered allowance by itself — batch diarization re-reads the entire
  // recording at the same per-minute rate as capturing it
  // (docs/BILLING_COST_MODEL.md §7). Defaulting it on meant a user who opened
  // this modal to reword some slides paid for speaker labelling they never
  // asked for, and the cost scales with lecture length rather than with what
  // they changed. It stays available on every plan; it is just opted into.
  const [identifySpeakers, setIdentifySpeakers] = useState(
    deck.refineIdentifySpeakers ?? false,
  )
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

  const loadTemplates = useCallback(() => {
    dispatchAction<Template[]>('template.list')
      .then(setTemplates)
      .catch(() => {
        // Quiet failure: the section simply stays empty
      })
  }, [])

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

  const switchTemplate = (templateId: string, known?: Template) => {
    dispatchAction<Deck>('deck.switchTemplate', { deckId: deck.id, templateId })
      .then(updated => {
        // A template just made by duplicating is not in the list yet, so the
        // panel hands it over; the slides should not wait for a reload to
        // show what the lecture is now using.
        const template =
          known?.id === updated.templateId
            ? known
            : templates.find(t => t.id === updated.templateId)
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

  /** Human summary of what a finished refine job changed. Each clause is
   * its own ICU plural, so the counts read correctly in every language,
   * and the list separator comes from the bundle too. */
  const summaryMessage = (s: RefineJobSummary): string => {
    const clauses = (
      [
        ['reframed', s.reframed],
        ['slidesRefined', s.slidesRefined],
        ['transcriptsUpdated', s.transcriptsUpdated],
      ] as const
    )
      .filter(([, count]) => count > 0)
      .map(([kind, count]) =>
        t(`deck.settings.refine.summary.${kind}`, { count }),
      )
    return clauses.length
      ? t('deck.settings.refine.summary.done', {
          changes: clauses.join(t('common.listSeparator')),
        })
      : t('deck.settings.refine.summary.none')
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
      setRefineMsg(t('deck.settings.refine.failed'))
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
    const index = tabs.findIndex(t => t.id === tab)
    const next =
      tabs[
        (index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
      ]!
    setTab(next.id)
    tabRefs.current.get(next.id)?.focus()
  }

  return (
    <Modal
      variant="sheet"
      ariaLabel={t('deck.settings.title')}
      onClose={onClose}
      initialFocusRef={closeRef}
      escapeCapture={false}
      escapeIgnoreTyping
    >
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{t('deck.settings.title')}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {/* Trans, not t: a link sits mid-sentence, and where in the
                sentence it falls is the translator's call. */}
            <Trans
              i18nKey="deck.settings.scope"
              components={{
                projectLink: (
                  <Link
                    to={`/app/projects/${deck.projectId}`}
                    state={{ openSettings: true }}
                    className="text-indigo-600 hover:underline"
                  />
                ),
              }}
            />
          </p>
        </div>
        <button
          ref={closeRef}
          aria-label={t('deck.settings.close')}
          title={t('common.closeEsc')}
          onClick={onClose}
          className="rounded-md p-2 text-slate-500 hover:text-slate-900"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {adminOverride && <AdminEditNotice entity="lecture" />}

      <div
        role="tablist"
        aria-label={t('deck.settings.sections')}
        onKeyDown={onTabKeyDown}
        className="mb-6 flex gap-1 border-b border-slate-200"
      >
        {tabs.map(tab_ => (
          <button
            key={tab_.id}
            ref={el => {
              if (el) tabRefs.current.set(tab_.id, el)
            }}
            role="tab"
            id={`settings-tab-${tab_.id}`}
            aria-selected={tab === tab_.id}
            aria-controls={`settings-panel-${tab_.id}`}
            tabIndex={tab === tab_.id ? 0 : -1}
            onClick={() => setTab(tab_.id)}
            className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium ${
              tab === tab_.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {t(`deck.settings.tabs.${tab_.id}`)}
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
              {t('deck.settings.general.titleHeading')}
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              {t('deck.settings.general.titleHint')}
            </p>
            <input
              aria-label={t('deck.settings.general.titleHeading')}
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              placeholder={t('lecture.untitled')}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              {t('deck.settings.general.seedNotesHeading')}
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              {t('deck.settings.general.seedNotesHint')}
            </p>
            <SeedNotesEditor
              value={deck.seedContext ?? ''}
              label={t('deck.settings.general.seedNotesLabel')}
              placeholder={t('deck.settings.general.seedNotesPlaceholder')}
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
          {!adminOverride && (
            <div>
              <h3 className="mb-2 text-lg font-semibold text-slate-700">
                {t('deck.settings.general.seedMaterialHeading')}
              </h3>
              <p className="mb-3 text-sm text-slate-500">
                {t('deck.settings.general.seedMaterialHint')}
              </p>
              <SeedMaterial projectId={deck.projectId} deckId={deck.id} />
            </div>
          )}
          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              {t('deck.settings.general.freedomHeading')}
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              {t('deck.settings.general.freedomHint')}
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
              {t('deck.settings.general.languageHeading')}
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              {t('deck.settings.general.languageHint')}
            </p>
            <LanguageSelect
              value={deck.language}
              defaultLabel={t('deck.settings.general.languageInherit')}
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
                {t('deck.settings.general.voiceHeading')}
              </h3>
              <p className="mb-3 text-sm text-slate-500">
                {t('deck.settings.general.voiceHint')}
              </p>
              <VoiceSelect
                value={deck.ttsVoice}
                defaultLabel={
                  findTtsVoice(projectTtsVoice)?.name ??
                  t('voice.systemDefault')
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
                {t('common.dangerZone')}
              </h3>
              <p className="mb-3 text-sm text-slate-600">
                {t('deck.settings.general.deleteHint')}
              </p>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                {t('deck.delete.action')}
              </button>
            </div>
          )}
        </section>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={t('deck.delete.title')}
          message={t('deck.delete.message', { name: lectureTitle(deck) })}
          confirmLabel={t('common.delete')}
          onConfirm={deleteLecture}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      {confirmingRefine && (
        <ConfirmDialog
          title={t('deck.settings.refine.markedTitle')}
          message={t('deck.settings.refine.markedMessage')}
          confirmLabel={t('deck.settings.refine.markedConfirm')}
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
            {t('template.heading')}
          </h3>
          {/* The lecture is drawn with the version it pinned, so an edit to
              its template is offered here rather than applied (TMPL-11). */}
          <TemplateUpdateNotice
            deckId={deck.id}
            onApplied={updated => {
              const template = templates.find(t => t.id === updated.templateId)
              if (template) onTemplateChange(updated, template)
            }}
          />
          <TemplateDesignPanel
            templates={templates}
            value={deck.templateId}
            onChange={switchTemplate}
            onLibraryChanged={loadTemplates}
          />
          <div className="mt-6 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={exportTemplate}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" aria-hidden />
              {t('template.exportYaml')}
            </button>
            <p className="mt-1 text-xs text-slate-500">
              {t('template.exportYamlHint')}
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
              {t('deck.settings.refine.heading')}
            </h3>
            <p className="text-sm text-slate-500">
              {adminOverride
                ? t('deck.settings.refine.introAdmin')
                : t('deck.settings.refine.intro')}
            </p>
            {!hasSlides && !adminOverride && (
              <p className="mt-2 text-sm text-amber-600">
                {t('deck.settings.refine.noSlides')}
              </p>
            )}
          </div>

          {/* An admin edits the saved choices even on an empty lecture;
              for the owner the form follows the Refine button. */}
          <fieldset
            disabled={!hasSlides && !adminOverride}
            className="flex flex-col gap-5"
          >
            <div>
              <RefineOption
                label={t('refine.speakers.label')}
                description={
                  <>
                    {t('refine.speakers.description')}
                    {!deck.hasRecordings && ` ${t('refine.speakers.noAudio')}`}
                  </>
                }
                checked={identifySpeakers}
                disabled={!deck.hasRecordings}
                onChange={checked => {
                  setIdentifySpeakers(checked)
                  saveRefineSettings({ identifySpeakers: checked })
                }}
              />
              {/* Steer people to the per-slide action instead. Diarization is
                  billed on the whole recording however few slides need it, so
                  running it lecture-wide usually pays to label a lot of audio
                  in which nobody but the lecturer speaks. Shown only when the
                  option is actually available — with no audio the toggle is
                  disabled and already explains itself. */}
              {deck.hasRecordings && (
                <p className="mt-2 text-xs text-slate-500">
                  {t('refine.speakers.wholeLectureHint')}
                </p>
              )}
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
              label={t('refine.transcript.label')}
              description={t('refine.transcript.description')}
              checked={refineTranscript}
              onChange={checked => {
                setRefineTranscript(checked)
                saveRefineSettings({ transcriptEnabled: checked })
              }}
            />

            <RefineLevelSlider
              value={level}
              ariaLabel={t('deck.settings.refine.levelLabel')}
              onChange={v => {
                setLevel(v)
                persistLevel(v)
              }}
            />
          </fieldset>

          {/* Running the pass rewrites the owner's slides, so it stays
              with them; an admin only sets what it would do. */}
          {!adminOverride && (
            <div>
              <button
                onClick={onRefineClick}
                disabled={refining || !anySelected || !hasSlides}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {refining ? t('refine.running') : t('refine.action')}
              </button>
              {refining && (
                <p className="mt-3 text-sm text-slate-500">
                  {t('refine.background')}
                </p>
              )}
              {refineMsg && (
                <p role="status" className="mt-3 text-sm text-slate-700">
                  {refineMsg}
                </p>
              )}
            </div>
          )}
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
          <ExportPanel deckId={deck.id} locale={contentLocale} />
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
