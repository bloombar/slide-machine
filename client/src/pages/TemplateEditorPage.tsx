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
 * Someone who did not author it — a built-in, or a design shared with them —
 * sees the same page without the editor: every layout as a rendered slide,
 * which is what a design is. A private template belonging to someone else is
 * refused exactly as a missing one is, so the URL says nothing about it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import type {
  Layout,
  Template,
  TemplateRenderMode,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { ApiError } from '../api/http'
import { useAuth } from '../auth/AuthContext'
import { displayHandle } from '../lib/handle'
import { templateName } from '../i18n/templateName'
import TemplateEditor from '../components/template/TemplateEditor'
import TemplatePreview from '../components/template/TemplatePreview'
import UnsavedChangesDialog from '../components/UnsavedChangesDialog'

export default function TemplateEditorPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { user, status } = useAuth()
  const [template, setTemplate] = useState<Template | null>(null)
  /** The rest of the library, for lifting a layout definition from. */
  const [library, setLibrary] = useState<Template[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [dirty, setDirty] = useState(false)
  /** Where leaving would go, held while the author is asked about unsaved
   * work; null when nothing is pending. */
  const [leavingTo, setLeavingTo] = useState<string | null>(null)
  const saveRef = useRef<(() => Promise<boolean>) | null>(null)

  /** Where "Back" goes: whatever sent the author here — a lecture's or a
   * project's Design tab — else their home screen. */
  const from = (location.state as { from?: string } | null)?.from ?? '/app'

  useEffect(() => {
    if (!slug) return
    // Wait for session restore: a pasted permalink must carry the author's
    // credentials, or their own private template would be refused.
    if (status === 'restoring') return
    let cancelled = false
    dispatchAction<Template>('template.get', { slug })
      .then(loaded => {
        if (!cancelled) setTemplate(loaded)
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

  const own = !!template && !!user && template.ownerId === user.id

  /** Writes the draft and stays here — a page is somewhere to keep working,
   * not a dialog to get out of. Resolves false when the save was refused, so
   * the editor and the leave dialog both know it is not safe to move on. */
  const save = useCallback(
    (draft: {
      name: string
      renderMode: TemplateRenderMode
      theme: Record<string, unknown>
      layouts: Layout[]
      visibility: Template['visibility']
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
            // the draft it holds is no longer unsaved work. Only template.get
            // names the author, so saving must not drop the byline with it.
            setTemplate(prev => ({
              ...saved,
              owner: saved.owner ?? prev?.owner,
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

  /** The "Saved" note is about the last write, so any further editing
   * retires it. */
  const onDirtyChange = useCallback((next: boolean) => {
    setDirty(next)
    if (next) setSavedNote(false)
  }, [])

  /** Leaving the page: unsaved work is asked about rather than dropped. */
  const leave = (to: string) => {
    if (dirty) setLeavingTo(to)
    else void navigate(to)
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

  if (!template) {
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
        <h1 className="truncate text-2xl font-bold">{name}</h1>
        {/* Whose design this is, reading through to their profile (SOC-4),
            in the same voice a project page names its owner. */}
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
      </header>

      {own ? (
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
        </>
      ) : (
        <section>
          {/* Not theirs to change. Saying so beats offering controls that
              would be refused, and the design itself is still worth seeing. */}
          <p className="mb-4 text-sm text-slate-500">
            {t('template.page.readOnly')}
          </p>
          <h2 className="mb-3 text-lg font-semibold text-slate-700">
            {t('template.layoutsLabel')}
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {template.layouts.map(layout => (
              <li key={layout.type} className="flex flex-col gap-1.5">
                <TemplatePreview
                  template={template}
                  layout={layout}
                  className="overflow-hidden rounded-lg border border-slate-200 p-1"
                />
                <span className="truncate px-1 text-sm font-medium">
                  {layout.label}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
              void navigate(to)
            })
          }}
          onDiscard={() => {
            const to = leavingTo
            setLeavingTo(null)
            void navigate(to)
          }}
          onCancel={() => setLeavingTo(null)}
        />
      )}
    </div>
  )
}
