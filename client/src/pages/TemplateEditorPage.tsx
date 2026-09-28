/**
 * One design template on a page of its own (TMPL-4), at its permalink
 * `/t/:slug` — the same shape a lecture's `/d/:slug` has, so a design can be
 * linked to, bookmarked and reloaded like anything else in the app.
 *
 * A template belongs to its author rather than to any one lecture, so editing
 * one happens here rather than inside a lecture's settings: the Design tab
 * lists the library and sends the author here to work. The heading says what
 * the design is called and whose it is, reading through to their profile the
 * way a project page does (SOC-4).
 *
 * Someone shared with as an editor gets the same editor its author does
 * (TMPL-26): `template.update` already accepts either, so the page does too.
 * Everyone else — a built-in, a viewer, or a design merely made public — sees
 * everything the editor shows, read-only (`TemplateReaderView`, TMPL-29),
 * plus a way to duplicate it into a copy of their own. A private template
 * belonging to someone else is refused exactly as a missing one is, so the
 * URL says nothing about it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import {
  steppableLayouts,
  templateDescription,
  type Layout,
  type Template,
  type TemplateRenderMode,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { ApiError } from '../api/http'
import { useAuth } from '../auth/AuthContext'
import { displayHandle } from '../lib/handle'
import { templateName } from '../i18n/templateName'
import AccessSettings from '../components/AccessSettings'
import TemplateEditor from '../components/template/TemplateEditor'
import TemplateReaderView from '../components/template/TemplateReaderView'
import UnsavedChangesDialog from '../components/UnsavedChangesDialog'
import VoteControl from '../components/VoteControl'
import VoteCount from '../components/discover/VoteCount'

export default function TemplateEditorPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { user, status } = useAuth()
  const [template, setTemplate] = useState<Template | null>(null)
  /** Which slug `template` was fetched for. Compared against the current
   * `slug` below rather than cleared with a `setTemplate(null)` at the top
   * of the fetch effect — the derived mismatch alone is what makes the page
   * fall back to its loading state the instant the URL changes (a reader's
   * duplicate landing them on a new `/t/:slug`), with no synchronous
   * `setState` call inside the effect body to trigger a needless extra
   * render for it. */
  const [loadedSlug, setLoadedSlug] = useState<string | undefined>(undefined)
  /** The rest of the library, for lifting a layout definition from. */
  const [library, setLibrary] = useState<Template[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [dirty, setDirty] = useState(false)
  /** The slug a duplicate was started from, held only while it is in
   * flight — compared against the current `slug` below rather than a plain
   * boolean, so the flag cannot outlive the page it was set on. React
   * Router keeps this same page component mounted across a `/t/:slug`
   * change, so a plain `duplicating` boolean, once set, would never clear
   * itself on its own: it would still read `true` — Duplicate stuck
   * disabled — for a design visited again later, long after the duplicate
   * it belonged to had finished. Cleared whenever a fetch resolves (below),
   * which a fresh visit to any design always triggers. */
  const [duplicatingSlug, setDuplicatingSlug] = useState<string | undefined>(
    undefined,
  )
  const [duplicateError, setDuplicateError] = useState<string | null>(null)
  /** Where leaving would go, held while the author is asked about unsaved
   * work; null when nothing is pending. */
  const [leavingTo, setLeavingTo] = useState<string | null>(null)
  const saveRef = useRef<(() => Promise<boolean>) | null>(null)

  /** Where "Back" goes: whatever sent the author here — a lecture's or a
   * project's Design tab — else their home screen. */
  const from = (location.state as { from?: string } | null)?.from ?? '/app'

  /**
   * "Back" to the Design Templates page lands on its "Mine" tab whenever the
   * design the caller is leaving is one Mine itself lists — owned, or shared
   * with them as an editor or a viewer (TMPL-28) — that tab is where a design
   * they opened, were shared, or duplicated into a copy actually lives, not
   * whichever sort the page happened to default to before it was reached.
   * Passed only when `from` is that page at all; anywhere else (a lecture's
   * or project's Design tab) is unaffected, and leaving a built-in or a
   * public design the caller has no role on keeps the page's own default
   * (Latest) rather than this.
   */
  const backState =
    from === '/app/templates' &&
    (template?.myRole === 'owner' ||
      template?.myRole === 'editor' ||
      template?.myRole === 'viewer')
      ? { sort: 'mine' }
      : undefined

  useEffect(() => {
    if (!slug) return
    // Wait for session restore: a pasted permalink must carry the author's
    // credentials, or their own private template would be refused.
    if (status === 'restoring') return
    let cancelled = false
    dispatchAction<Template>('template.get', { slug })
      .then(loaded => {
        if (cancelled) return
        setTemplate(loaded)
        setLoadedSlug(slug)
        // A fresh, complete load of any design — this one included — means
        // nothing is still "duplicating" from this page's point of view; see
        // `duplicatingSlug`'s own comment for why this can't be left to a
        // plain boolean that only ever gets set, never cleared.
        setDuplicatingSlug(undefined)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setLoadError(
          e instanceof ApiError && (e.status === 403 || e.status === 404)
            ? t('template.page.missing')
            : t('template.errors.load'),
        )
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, status])

  useEffect(() => {
    let cancelled = false
    dispatchAction<Template[]>('template.list')
      .then(list => {
        if (!cancelled) setLibrary(list)
      })
      .catch(() => {
        // Quiet failure: only adding a layout is poorer for it
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Anyone the design is shared with as an editor gets the editor, not only
  // its author (TMPL-26) — `template.update` already accepts either, so the
  // page's own gate is widened to match rather than leaving an editor stuck
  // on the read-only view their role would otherwise pass.
  const canEdit =
    !!template &&
    !!user &&
    (template.myRole === 'owner' || template.myRole === 'editor')

  /** Writes the draft and stays here — a page is somewhere to keep working,
   * not a dialog to get out of. Resolves false when the save was refused, so
   * the editor and the leave dialog both know it is not safe to move on. */
  const save = useCallback(
    (draft: {
      name: string
      renderMode: TemplateRenderMode
      theme: Record<string, unknown>
      layouts: Layout[]
      aiInstructions?: string
    }): Promise<boolean> => {
      if (!template) return Promise.resolve(false)
      setSaving(true)
      setError(null)
      return (
        dispatchAction<Template>('template.update', {
          templateId: template.id,
          ...draft,
        })
          .then(saved => {
            // The saved template becomes what the editor compares against, so
            // the draft it holds is no longer unsaved work. `template.update`
            // returns a bare `toTemplateDto`, not the batch-loaded
            // `decorateTemplates` `template.get`/`.list` use — so it carries
            // neither the author (`owner`) nor the vote tally (`votes`)
            // (TMPL-27 round 2). Saving must not drop either from what the
            // page already knew: `owner` never changes on a save, and a vote
            // is independent of the draft `template.update` writes, so both
            // simply carry forward from `prev`.
            //
            // `layoutCount`/`description` are different (round 3): both are
            // *derived from* the draft just saved — a layout added or
            // removed, or `aiInstructions` reworded — so carrying the old
            // values forward would go stale the instant either changed.
            // Recomputed here with the same shared helpers the server's own
            // `decorateTemplates` uses, so the card these feed (TMPL-28)
            // shows this save's own layouts and instructions immediately,
            // rather than waiting on the next `template.get`/`.list`.
            setTemplate(prev => ({
              ...saved,
              owner: saved.owner ?? prev?.owner,
              votes: saved.votes ?? prev?.votes,
              layoutCount: steppableLayouts(saved.layouts).length,
              description: templateDescription(saved.aiInstructions),
            }))
            setSavedNote(true)
            return true
          })
          // The server's own words when it has any: a refused save is almost
          // always a specific thing about the design.
          .catch((e: unknown) => {
            setError(
              e instanceof ApiError && e.message
                ? e.message
                : t('template.errors.save'),
            )
            return false
          })
          .finally(() => setSaving(false))
      )
    },
    [template, t],
  )

  /**
   * General access changed through the owner's `AccessSettings` sharing
   * panel below (TMPL-26) — its own `template.setAccess` call, not a save of
   * the editor's draft — so this only adopts `visibility` and `myRole`,
   * never `name`/`theme`/`layouts`, which stay the exact references
   * `template` already held. An unsaved rename or edit sitting in the
   * editor's own draft is compared against those references
   * (`TemplateEditor`'s adopt effect), so replacing them here — even with
   * values that happen to be unchanged — would read as a new template to
   * adopt and silently discard the draft.
   */
  const onTemplateChanged = useCallback((updated: Template) => {
    setTemplate(prev =>
      prev
        ? { ...prev, visibility: updated.visibility, myRole: updated.myRole }
        : updated,
    )
  }, [])

  /** The "Saved" note is about the last write, so any further editing
   * retires it. */
  const onDirtyChange = useCallback((next: boolean) => {
    setDirty(next)
    if (next) setSavedNote(false)
  }, [])

  /** Leaving the page: unsaved work is asked about rather than dropped. */
  const leave = (to: string) => {
    if (dirty) setLeavingTo(to)
    else void navigate(to, backState ? { state: backState } : undefined)
  }

  /**
   * A reader's own way to adopt the design: a copy of their own, landing them
   * straight in its editor (TMPL-29). The same call and the same "straight
   * into editing" landing `TemplateDesignPanel`'s library uses — a design is
   * duplicated to be worked on, not to sit unopened in a library.
   */
  const duplicate = () => {
    if (!template || !slug) return
    setDuplicatingSlug(slug)
    setDuplicateError(null)
    dispatchAction<Template>('template.duplicate', { templateId: template.id })
      .then(copy => {
        // Wherever this page itself was reached from carries forward to the
        // copy's page too — the same `state.from` chain `TemplateDesignPanel`
        // starts when it duplicates — falling back to this page's own URL
        // rather than `from`'s '/app' default, so "Back" on the copy has
        // somewhere to go even when this page was opened directly (a shared
        // link, a search result) rather than from a lecture's Design tab.
        // `duplicatingSlug` is left set rather than cleared here: the page
        // is on its way to the copy's URL, and the button for the design
        // that is leaving should not spring back to life mid-navigation —
        // the fetch effect above clears it once a design (any design) has
        // fully loaded again.
        void navigate(`/t/${copy.permalinkSlug}`, {
          state: {
            from:
              (location.state as { from?: string } | null)?.from ??
              location.pathname,
          },
        })
      })
      .catch(() => {
        setDuplicateError(t('template.errors.duplicate'))
        setDuplicatingSlug(undefined)
      })
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <p role="alert" className="text-slate-600">
          {loadError}
        </p>
      </div>
    )
  }

  // A new slug means a different design — a reader's Duplicate lands them on
  // one straight from this same page component, which React Router keeps
  // mounted across a `/t/:slug` param change rather than remounting — so
  // `template` from the previous slug is not shown, or clicked on, while its
  // replacement is still in flight; the page reads as still loading instead.
  if (!template || loadedSlug !== slug) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <p className="text-slate-500">{t('common.loading')}</p>
      </div>
    )
  }

  const name = templateName(t, template)

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-8">
      <header className="mb-6">
        <button
          type="button"
          onClick={() => leave(from)}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('common.back')}
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">{name}</h1>
            {/* Whose design this is, reading through to their profile
                (SOC-4), in the same voice a project page names its owner. */}
            {template.owner && (
              <p className="mt-1 truncate text-slate-600">
                <Link
                  to={`/u/${template.owner.id}`}
                  className="hover:text-indigo-600 hover:underline"
                >
                  {displayHandle(template.owner.displayName)}
                </Link>
              </p>
            )}
          </div>
          {/* The header row's own actions, at the right. A reader's
              Duplicate sits left of the vote (TMPL-27); an editor gets no
              Duplicate here (`TemplateDesignPanel`'s library already offers
              it), only the vote. The owner sees the tally everyone else's
              vote feeds, not buttons to vote on their own work. */}
          <div className="flex shrink-0 items-center gap-2">
            {!canEdit && (
              <button
                type="button"
                onClick={duplicate}
                disabled={duplicatingSlug === slug}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {t('template.duplicate')}
              </button>
            )}
            {template.myRole === 'owner' ? (
              <VoteCount
                up={template.votes?.up ?? 0}
                down={template.votes?.down ?? 0}
              />
            ) : (
              <VoteControl
                target={{ kind: 'template', id: template.id }}
                name={name}
                up={template.votes?.up ?? 0}
                down={template.votes?.down ?? 0}
                myVote={template.votes?.myVote ?? 0}
                onChange={res => {
                  // The design this vote was cast on, captured from this
                  // render rather than read back off state later (TMPL-27
                  // round 3): a reader's Duplicate, or any other navigation
                  // to a different `/t/:slug`, keeps this same page
                  // component mounted and swaps `template` for a different
                  // design entirely — a response arriving after that swap
                  // must not write this vote's tally into whatever design
                  // is now current.
                  const votedId = template.id
                  setTemplate(prev =>
                    prev && prev.id === votedId
                      ? {
                          ...prev,
                          votes: {
                            up: res.up,
                            down: res.down,
                            myVote: res.myVote,
                          },
                        }
                      : prev,
                  )
                }}
              />
            )}
          </div>
        </div>
      </header>
      {duplicateError && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {duplicateError}
        </p>
      )}

      {canEdit ? (
        <>
          {savedNote && (
            <p
              role="status"
              data-testid="template-saved"
              className="mb-3 text-sm text-emerald-700"
            >
              {t('template.page.saved')}
            </p>
          )}
          <TemplateEditor
            template={template}
            layoutSources={library}
            onSave={save}
            onDirtyChange={onDirtyChange}
            saveRef={saveRef}
            onCancel={() => leave(from)}
            saving={saving}
            error={error}
          />
          {/* The owner's sharing panel, beside the editor rather than nested
              inside it (TMPL-26 round 2): `AccessSettings` renders its own
              `<form>` for "Add people", and a form inside `TemplateEditor`'s
              own form broke the "Add" button outright — the click submitted
              both, natively, dropping the click on the floor. An editor
              never reaches `template.setAccess`, so they get none of this;
              `TemplateSettings` shows them a disabled read-out instead. */}
          {template.myRole === 'owner' && (
            <AccessSettings
              entity="template"
              subject={{
                id: template.id,
                name,
                visibility: template.visibility,
              }}
              isOwner
              onChange={updated => onTemplateChanged(updated as Template)}
              // template.get requires sign-in, so a design's "public" is
              // never "anyone on the internet" — the generic lecture/project
              // wording is wrong here (TMPL-26 round 2).
              hints={{
                public: t('template.visibilityHint.public'),
                restricted: t('template.visibilityHint.restricted'),
              }}
            />
          )}
        </>
      ) : (
        <>
          {/* Not theirs to change. Saying so beats offering controls that
              would be refused, and the design itself — everything the
              editor shows, read-only (TMPL-29) — is still worth seeing. */}
          <p className="mb-4 text-sm text-slate-500">
            {t('template.page.readOnly')}
          </p>
          {/* Keyed on the design's own id, so navigating from one design's
              page straight to another's (the copy Duplicate lands on) remounts
              the reader rather than carrying over which layout or box the
              previous design had selected — React Router keeps this same
              page component mounted across a `/t/:slug` param change. */}
          <TemplateReaderView key={template.id} template={template} />
        </>
      )}

      {/* Leaving with unsaved work offers to save it, rather than only to
          lose it — the editor's own save does the writing. */}
      {leavingTo && (
        <UnsavedChangesDialog
          title={t('template.discard.title')}
          message={t('template.discard.message')}
          saveLabel={t('template.discard.save')}
          discardLabel={t('template.discard.confirm')}
          saving={saving}
          onSave={() => {
            void saveRef.current?.().then(written => {
              // Only when it was written: a refused save that left the page
              // would lose the work this dialog is protecting.
              if (!written) {
                setLeavingTo(null)
                return
              }
              const to = leavingTo
              setLeavingTo(null)
              void navigate(to, backState ? { state: backState } : undefined)
            })
          }}
          onDiscard={() => {
            const to = leavingTo
            setLeavingTo(null)
            void navigate(to, backState ? { state: backState } : undefined)
          }}
          onCancel={() => setLeavingTo(null)}
        />
      )}
    </div>
  )
}
