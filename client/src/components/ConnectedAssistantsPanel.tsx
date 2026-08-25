/**
 * The AI assistants connected to this account, and the button that cuts one
 * off (docs/MCP.md §5.3).
 *
 * This panel is what makes the consent screen honest. Approving a grant is
 * only a reasonable thing to ask of someone if they can take it back later
 * without consequence, and "revocation without collateral damage" —
 * disconnect one assistant, stay signed in everywhere else — is the concrete
 * advantage OAuth has over handing an assistant a password. A promise with
 * nowhere to exercise it is not a promise.
 *
 * Disconnecting is immediate and needs no confirmation. It is not
 * destructive: nothing of the account's is lost, the assistant simply stops
 * having access, and reconnecting is one consent screen away. A dialog here
 * would add friction to the safe direction, which is exactly backwards.
 *
 * It also hands over the address to connect one, which is the only part of
 * that flow the app can offer. There is no "connect" button and there cannot
 * be: an authorization flow starts at the assistant, because only the
 * assistant knows its own identity and where a code should be sent back to —
 * the same reason an account is linked to Google from here rather than from
 * Google. What the app *can* do is say what to paste, and without that the
 * empty state is a dead end: it reports that nothing is connected without
 * saying how to change that.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Unplug } from 'lucide-react'
import { getAgentAccessEnabled } from '../runtime-config'
import { dispatchAction } from '../api/actions'
import { apiErrorMessage } from '../i18n/apiError'
import { formatDate } from '../i18n/format'

interface Connection {
  clientId: string
  clientName: string
  permissions: string[]
  connectedAt: string
}

export default function ConnectedAssistantsPanel() {
  const { t } = useTranslation()
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // A counter rather than a callback that refetches: there is exactly one
  // place that reads the list — the effect — so a reload is "ask again",
  // not a second copy of the same request that can drift from it.
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let live = true
    dispatchAction<Connection[]>('mcp.connections')
      .then(rows => live && setConnections(rows))
      .catch((err: unknown) => {
        if (live) setError(apiErrorMessage(err, t, 'assistants.failed'))
      })
    return () => {
      live = false
    }
  }, [t, reloads])

  const cut = async (clientId: string) => {
    setBusy(clientId)
    try {
      await dispatchAction('mcp.disconnect', { clientId })
      // Re-read rather than splice the row out locally: the server decides
      // what is still connected, and a token that expired between the two
      // calls should disappear too.
      setReloads(count => count + 1)
    } catch (err) {
      setError(apiErrorMessage(err, t, 'assistants.failed'))
    } finally {
      setBusy(null)
    }
  }

  /**
   * The address an assistant is pointed at.
   *
   * Read from the browser rather than configured, because it is by definition
   * the origin this page was served from — a deployment cannot be reached at
   * an address that would not have loaded this page.
   */
  const serverUrl = `${window.location.origin}/api/mcp`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serverUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused (an insecure origin, a permission
      // policy). The address is on screen and selectable either way, so this
      // is a convenience failing, not the feature failing.
    }
  }

  /** How to connect one — shown whether or not any are connected yet. */
  const howToConnect = getAgentAccessEnabled() ? (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-800">
        {t('assistants.connectTitle')}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {t('assistants.connectHint')}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800">
          {serverUrl}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {copied ? t('assistants.copied') : t('common.copy')}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {t('assistants.connectApproval')}
      </p>
    </div>
  ) : null

  if (error) return <p className="text-sm text-rose-600">{error}</p>
  if (!connections)
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>

  if (connections.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-500">{t('assistants.none')}</p>
        {howToConnect}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {howToConnect}
      <ul className="flex flex-col gap-3">
        {connections.map(connection => (
          <li
            key={connection.clientId}
            className="flex items-start justify-between gap-4 rounded-md border border-slate-200 p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">
                {connection.clientName}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {t('assistants.connectedOn', {
                  date: formatDate(connection.connectedAt),
                })}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {connection.permissions.map(permission => (
                  <li key={permission} className="text-xs text-slate-600">
                    {permission}
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => void cut(connection.clientId)}
              disabled={busy === connection.clientId}
              className="flex shrink-0 items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Unplug className="h-4 w-4" aria-hidden="true" />
              {t('assistants.disconnect')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
