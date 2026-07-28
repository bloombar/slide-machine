/**
 * Admin view of one lecture: its project and owner, its details
 * (id, visibility, slide count, dates), a link to the live slideshow at
 * /d/:slug (always openable for admins), and a danger zone for
 * deleting the lecture — confirmed first and recorded in the admin
 * audit log server-side.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  findTtsVoice,
  LOCALE_LABELS,
  type AdminDeckSettingsPatch,
  type Locale,
  type Visibility,
} from '@slide-machine/shared'
import {
  deleteAdminDeck,
  fetchAdminDeck,
  logAdminDeckView,
  updateAdminDeckSettings,
} from '../api/admin'
import type { AdminDeckDetailResponse } from '../api/admin'
import { ApiError } from '../api/http'
import ConfirmDialog from '../components/ConfirmDialog'
import FreedomSlider from '../components/FreedomSlider'
import LanguageSelect from '../components/LanguageSelect'
import Modal from '../components/Modal'
import VoiceSelect from '../components/VoiceSelect'
import DetailRow from '../components/admin/DetailRow'
import { VisibilityBadge } from '../components/admin/LectureTable'
import SeedMaterialView from '../components/admin/SeedMaterialView'
import SettingsPanel from '../components/admin/SettingsPanel'
import { getTtsEnabled } from '../runtime-config'
import {
  formatValue,
  type FieldLabel,
  type FieldLabels,
} from '../lib/admin-changes'
import { projectTitle } from '../lib/project'

/** The action the admin has asked for but not yet confirmed. */
type PendingAction = { kind: 'delete' } | { kind: 'view-private' }

/**
 * A lecture's admin-editable settings. An absent value means the lecture
 * inherits it — for `visibility`, that it still follows its project's
 * access settings; pinning any value detaches it permanently.
 */
interface DeckSettingsDraft {
  visibility?: Visibility
  generationFreedom?: number
  language?: Locale
  ttsVoice?: string
  refineIdentifySpeakers?: boolean
  refineSlidesEnabled?: boolean
  refineSlidesLevel?: number
  refineTranscriptEnabled?: boolean
  refineTranscriptLevel?: number
}

/** Value of the "Default (inherited)" option in every settings select. */
const INHERIT = ''

const onOffField = (label: string): FieldLabel => ({
  label,
  format: value =>
    value === undefined || value === null
      ? formatValue(undefined)
      : value
        ? 'On'
        : 'Off',
})

const DECK_FIELDS: FieldLabels<DeckSettingsDraft> = {
  visibility: {
    label: 'Visibility',
    format: value =>
      value === 'public'
        ? 'Public'
        : value === 'restricted'
          ? 'Private'
          : "Follows the project's settings",
  },
  generationFreedom: 'AI freedom',
  language: {
    label: 'Language',
    format: value =>
      value ? LOCALE_LABELS[value as Locale] : formatValue(undefined),
  },
  ttsVoice: {
    label: 'Narration voice',
    format: value =>
      value
        ? (findTtsVoice(String(value))?.label ?? String(value))
        : formatValue(undefined),
  },
  refineIdentifySpeakers: onOffField('Identify multiple speakers'),
  refineSlidesEnabled: onOffField('Refine all slides'),
  refineSlidesLevel: 'Slide refinement level',
  refineTranscriptEnabled: onOffField('Refine the spoken transcript'),
  refineTranscriptLevel: 'Transcript refinement level',
}

const fieldLabelClass = 'block text-sm font-medium text-slate-700'
const selectClass =
  'mt-1 block w-fit rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'

/** A refine toggle as three states: inherit the default, or pin on/off. */
function OnOffSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value?: boolean
  onChange: (value?: boolean) => void
}) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <select
        id={id}
        value={value === undefined ? INHERIT : String(value)}
        onChange={e =>
          onChange(
            e.target.value === INHERIT ? undefined : e.target.value === 'true',
          )
        }
        className={selectClass}
      >
        <option value={INHERIT}>Default (inherited)</option>
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    </div>
  )
}

/** A 1-5 refinement strength, or the inherited server default. */
function LevelSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value?: number
  onChange: (value?: number) => void
}) {
  return (
    <div>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <select
        id={id}
        value={value === undefined ? INHERIT : String(value)}
        onChange={e =>
          onChange(
            e.target.value === INHERIT ? undefined : Number(e.target.value),
          )
        }
        className={selectClass}
      >
        <option value={INHERIT}>Default (inherited)</option>
        {[1, 2, 3, 4, 5].map(n => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  )
}

const asDate = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

export default function AdminDeckPage() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<AdminDeckDetailResponse | null>(null)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showSeed, setShowSeed] = useState(false)
  // Bumped after a settings save so the page reads back what was stored
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!deckId) return
    let cancelled = false
    fetchAdminDeck(deckId)
      .then(detail => {
        if (!cancelled) setLoaded(detail)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [deckId, version])

  /** Opens the live slideshow. Public lectures open straight away; opening
   * a private one is confirmed first and recorded in the audit log,
   * mirroring the always-on admin viewer bypass. */
  const openSlideshow = () => {
    if (!loaded) return
    if (loaded.deck.visibility === 'public') {
      navigate(`/d/${loaded.deck.permalinkSlug}`)
      return
    }
    setPending({ kind: 'view-private' })
  }

  /** Runs the confirmed action; both viewing a private lecture and
   * deleting one leave this page. */
  const runPending = async () => {
    if (!deckId || !loaded || !pending) return
    const action = pending
    setPending(null)
    setActionError(null)
    try {
      if (action.kind === 'view-private') {
        // Log the private-lecture access before handing over to the viewer
        await logAdminDeckView(deckId)
        navigate(`/d/${loaded.deck.permalinkSlug}`)
        return
      }
      await deleteAdminDeck(deckId)
      navigate(`/app/admin/projects/${loaded.project.id}`)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed.')
    }
  }

  /** Link back to the project's admin page (or the directory while the
   * project is unknown), shown in every page state. */
  const backLink = loaded ? (
    <Link
      to={`/app/admin/projects/${loaded.project.id}`}
      className="mb-3 inline-block text-sm text-slate-500 hover:underline"
    >
      &larr; {projectTitle(loaded.project)}
    </Link>
  ) : (
    <Link
      to="/app/admin"
      className="mb-3 inline-block text-sm text-slate-500 hover:underline"
    >
      &larr; All users
    </Link>
  )

  if (error) {
    return (
      <div>
        {backLink}
        <p className="text-red-600">Could not load this lecture.</p>
      </div>
    )
  }
  if (!loaded) {
    return (
      <div>
        {backLink}
        <p className="text-slate-500">Loading…</p>
      </div>
    )
  }

  const { deck, project, owner, seed, settings } = loaded
  const title = deck.title.trim() || 'Untitled lecture'
  // An inheriting lecture has no visibility of its own; the effective one
  // the read returns belongs to its project.
  const settingsDraft: DeckSettingsDraft = {
    visibility: settings.accessInherited ? undefined : settings.visibility,
    generationFreedom: settings.generationFreedom,
    language: settings.language,
    ttsVoice: settings.ttsVoice,
    refineIdentifySpeakers: settings.refineIdentifySpeakers,
    refineSlidesEnabled: settings.refineSlidesEnabled,
    refineSlidesLevel: settings.refineSlidesLevel,
    refineTranscriptEnabled: settings.refineTranscriptEnabled,
    refineTranscriptLevel: settings.refineTranscriptLevel,
  }
  // Any seed material at either level — the lecture's own or the project's.
  const seedUsed =
    Boolean(seed.lecture.notes) ||
    seed.lecture.assets.length > 0 ||
    Boolean(seed.project.notes) ||
    seed.project.assets.length > 0

  /** Copy for the confirmation dialog of each pending action. */
  const confirmCopy = (action: PendingAction) =>
    action.kind === 'delete'
      ? {
          title: 'Delete this lecture?',
          message: `"${title}" and everything under it will be permanently deleted. This cannot be undone.`,
          confirmLabel: 'Delete lecture',
        }
      : {
          title: 'View this private lecture?',
          message: `"${title}" is a private lecture. Opening it as an admin is recorded in the audit log.`,
          confirmLabel: 'View slideshow',
        }

  return (
    <div>
      {backLink}
      <div className="mb-1 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        <VisibilityBadge visibility={deck.visibility} />
      </div>
      <p className="mb-6 text-slate-500">
        In{' '}
        <Link
          to={`/app/admin/projects/${project.id}`}
          className="hover:underline"
        >
          {projectTitle(project)}
        </Link>{' '}
        · owned by{' '}
        <Link to={`/app/admin/users/${owner.id}`} className="hover:underline">
          {owner.displayName}
        </Link>{' '}
        ({owner.email})
      </p>

      {actionError && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {actionError}
        </p>
      )}

      <button
        onClick={openSlideshow}
        className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        View slideshow
      </button>

      <section className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="mb-2 text-lg font-semibold text-slate-700">Details</h2>
        <dl>
          <DetailRow label="ID" value={deck.id} mono />
          <DetailRow label="Slides" value={String(deck.slideCount)} />
          <DetailRow label="Created" value={asDate(deck.createdAt)} />
          <DetailRow label="Updated" value={asDate(deck.updatedAt)} />
          <DetailRow label="Permalink" value={`/d/${deck.permalinkSlug}`} />
        </dl>
      </section>

      <SettingsPanel
        value={settingsDraft}
        labels={DECK_FIELDS}
        confirmTitle="Save these lecture settings?"
        description="Editing another user's lecture. Choosing any visibility detaches it from its project's access settings for good."
        onSave={async patch => {
          if (!deckId) return
          // The panel's patch type allows null on every field; the wire
          // type matches it here — null clears each level to inherited.
          await updateAdminDeckSettings(deckId, patch as AdminDeckSettingsPatch)
          setVersion(v => v + 1)
        }}
      >
        {(draft, set) => (
          <>
            <div>
              <label
                htmlFor="admin-deck-visibility"
                className={fieldLabelClass}
              >
                Visibility
              </label>
              <select
                id="admin-deck-visibility"
                value={draft.visibility ?? INHERIT}
                onChange={e =>
                  set(
                    'visibility',
                    e.target.value === INHERIT
                      ? undefined
                      : (e.target.value as Visibility),
                  )
                }
                className={selectClass}
              >
                <option value={INHERIT}>
                  Follow the project&apos;s settings
                </option>
                <option value="public">Public</option>
                <option value="restricted">Private</option>
              </select>
            </div>
            <div>
              <p className={fieldLabelClass}>AI freedom</p>
              <FreedomSlider
                value={draft.generationFreedom}
                inheritedValue={settings.effectiveGenerationFreedom}
                // No debounce: nothing saves until Save changes, and a
                // pending timer would drop the last drag on click.
                debounceMs={0}
                onChange={freedom =>
                  set('generationFreedom', freedom ?? undefined)
                }
              />
            </div>
            <div>
              <p className={fieldLabelClass}>Language</p>
              <LanguageSelect
                value={draft.language}
                defaultLabel="project setting"
                onChange={language => set('language', language ?? undefined)}
              />
            </div>
            {getTtsEnabled() && (
              <div>
                <p className={fieldLabelClass}>Narration voice</p>
                <VoiceSelect
                  value={draft.ttsVoice}
                  defaultLabel="project setting"
                  onChange={voice => set('ttsVoice', voice ?? undefined)}
                />
              </div>
            )}
            <fieldset className="flex flex-col gap-4 rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium text-slate-700">
                Refine
              </legend>
              <OnOffSelect
                id="admin-refine-speakers"
                label="Identify multiple speakers"
                value={draft.refineIdentifySpeakers}
                onChange={v => set('refineIdentifySpeakers', v)}
              />
              <OnOffSelect
                id="admin-refine-slides"
                label="Refine all slides"
                value={draft.refineSlidesEnabled}
                onChange={v => set('refineSlidesEnabled', v)}
              />
              <LevelSelect
                id="admin-refine-slides-level"
                label="Slide refinement level"
                value={draft.refineSlidesLevel}
                onChange={v => set('refineSlidesLevel', v)}
              />
              <OnOffSelect
                id="admin-refine-transcript"
                label="Refine the spoken transcript"
                value={draft.refineTranscriptEnabled}
                onChange={v => set('refineTranscriptEnabled', v)}
              />
              <LevelSelect
                id="admin-refine-transcript-level"
                label="Transcript refinement level"
                value={draft.refineTranscriptLevel}
                onChange={v => set('refineTranscriptLevel', v)}
              />
            </fieldset>
          </>
        )}
      </SettingsPanel>

      <section className="mt-6 rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-700">
              Seed material
            </h2>
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                seedUsed
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-slate-100 text-slate-600'
              }`}
            >
              {seedUsed ? 'Used' : 'None'}
            </span>
          </div>
          {seedUsed && (
            <button
              onClick={() => setShowSeed(true)}
              className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View seed material
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {seedUsed
            ? 'Source material fed this lecture’s generation, including any inherited from the project.'
            : 'No source material fed this lecture’s generation.'}
        </p>
      </section>

      <section className="mt-8 rounded-lg border border-red-200 p-4">
        <h2 className="mb-1 text-lg font-semibold text-red-700">Danger zone</h2>
        <p className="mb-3 text-sm text-slate-600">
          Every action here is recorded in the{' '}
          <Link to="/app/admin/logs" className="underline">
            audit log
          </Link>
          .
        </p>
        <button
          onClick={() => setPending({ kind: 'delete' })}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
        >
          Delete lecture
        </button>
      </section>

      {pending && (
        <ConfirmDialog
          {...confirmCopy(pending)}
          onConfirm={() => void runPending()}
          onCancel={() => setPending(null)}
        />
      )}

      {showSeed && (
        <Modal
          onClose={() => setShowSeed(false)}
          ariaLabel="Seed material"
          size="lg"
          className="max-h-[80vh] overflow-y-auto"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-800">
              Seed material
            </h2>
            <button
              onClick={() => setShowSeed(false)}
              className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          <SeedMaterialView seed={seed} projectTitle={projectTitle(project)} />
        </Modal>
      )}
    </div>
  )
}
