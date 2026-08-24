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
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Unplug } from 'lucide-react'
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

  if (error) return <p className="text-sm text-rose-600">{error}</p>
  if (!connections)
    return <p className="text-sm text-slate-500">{t('common.loading')}</p>

  if (connections.length === 0) {
    return <p className="text-sm text-slate-500">{t('assistants.none')}</p>
  }

  return (
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
  )
}
