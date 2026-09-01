/**
 * "Claude wants to read and edit your lectures. Allow?" (docs/MCP.md §5.1)
 *
 * The one screen that makes this feature safe to offer. Everything else in the
 * OAuth subsystem is machinery; this is where a person decides, and it is the
 * only gate that stands between an assistant anybody can register and an
 * instructor's lecture material.
 *
 * Three things it must get right:
 *
 *   - **Say who is asking.** The name comes from the assistant's own
 *     registration, so it is a label rather than a claim — anything may
 *     register under any name. The screen therefore leans on naming the
 *     *permissions* in the user's own words, which cannot be faked, rather
 *     than on the user recognising the name.
 *   - **Say what is being granted, in a sentence.** Not a scope string. A
 *     consent screen the user cannot parse is theatre (docs/MCP.md §5.4).
 *   - **Make declining as easy as accepting**, and send the refusal back to
 *     the assistant, so it can say "you declined" rather than hang.
 *
 * It leaves the app: both answers navigate to a URL the *assistant* owns, so
 * `window.location` rather than the router.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import {
  approveConsent,
  denyConsent,
  getConsentRequest,
  type ConsentRequest,
} from '../api/oauth'
import { ApiError } from '../api/http'

const CARD_CLASS =
  'mx-auto mt-16 w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm'

export default function OAuthConsentPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const requestId = params.get('request') ?? ''

  const [request, setRequest] = useState<ConsentRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // A URL with no request in it is not a failure to report from an effect —
    // it is derivable from the URL, and handled below where it is rendered.
    if (!requestId) return
    let cancelled = false
    getConsentRequest(requestId)
      .then(loaded => {
        if (!cancelled) setRequest(loaded)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Missing, expired and already-answered are one answer by design, so
        // there is one message for all three.
        setError(
          err instanceof ApiError && err.status === 404
            ? t('oauth.expired')
            : t('oauth.failed'),
        )
      })
    return () => {
      cancelled = true
    }
  }, [requestId, t])

  const respond = useCallback(
    async (accept: boolean) => {
      setBusy(true)
      try {
        const { redirectTo } = accept
          ? await approveConsent(requestId)
          : await denyConsent(requestId)
        // Back to the assistant, which is not part of this app.
        window.location.assign(redirectTo)
      } catch {
        setError(t('oauth.failed'))
        setBusy(false)
      }
    },
    [requestId, t],
  )

  const problem = requestId ? error : t('oauth.expired')

  if (problem) {
    return (
      <div className={CARD_CLASS}>
        <h1 className="text-lg font-semibold text-slate-900">
          {t('oauth.title')}
        </h1>
        <p className="mt-3 text-sm text-slate-600">{problem}</p>
      </div>
    )
  }

  if (!request) {
    return (
      <div className={CARD_CLASS}>
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center gap-2 text-indigo-600">
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-slate-900">
          {t('oauth.title')}
        </h1>
      </div>

      <p className="mt-4 text-sm text-slate-700">
        {t('oauth.asking', { name: request.clientName })}
      </p>

      <ul className="mt-4 space-y-2">
        {request.scopes.map(scope => (
          <li
            key={scope.scope}
            className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800"
          >
            {scope.description}
          </li>
        ))}
      </ul>

      {/* The limits are stated on the screen where the decision is made,
          rather than left to be discovered — they are most of what makes
          saying yes reasonable. */}
      <p className="mt-4 text-xs text-slate-500">{t('oauth.limits')}</p>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={() => void respond(true)}
          disabled={busy}
          className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {t('oauth.allow')}
        </button>
        <button
          type="button"
          onClick={() => void respond(false)}
          disabled={busy}
          className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {t('oauth.deny')}
        </button>
      </div>
    </div>
  )
}
