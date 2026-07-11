/**
 * Owner-only access controls for a lecture (SHARE-1), Google-Docs
 * style. "People with access": add people by account email and choose
 * per person whether they can edit or only view — this is how other
 * editors are granted. "General access": Public (anyone on the internet
 * with the link can view, the default) or Restricted (only people with
 * access can open with the link). Changes save immediately through the
 * action layer.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type {
  Deck,
  DeckShare,
  ShareRole,
  Visibility,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'

const GENERAL_ACCESS: Array<{
  value: Visibility
  label: string
  hint: string
}> = [
  {
    value: 'public',
    label: 'Public',
    hint: 'Anyone on the internet with the link can view',
  },
  {
    value: 'restricted',
    label: 'Restricted',
    hint: 'Only people with access can open with the link',
  },
]

interface Props {
  deck: Deck
  /** Fired after a successful save so the viewer keeps a fresh deck. */
  onAccessChange: (deck: Deck) => void
}

export default function DeckAccessSettings({ deck, onAccessChange }: Props) {
  const [shares, setShares] = useState<DeckShare[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ShareRole>('viewer')
  const [shareError, setShareError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    dispatchAction<DeckShare[]>('deck.shares', { deckId: deck.id })
      .then(list => {
        if (!cancelled) setShares(list)
      })
      .catch(() => {
        // Quiet failure: the list simply stays empty
      })
    return () => {
      cancelled = true
    }
  }, [deck.id])

  const setGeneralAccess = (visibility: Visibility) => {
    dispatchAction<Deck>('deck.setAccess', { deckId: deck.id, visibility })
      .then(onAccessChange)
      .catch(() => {
        // Quiet failure: the radios revert to the saved deck on rerender
      })
  }

  const grant = (grantEmail: string, grantRole: ShareRole) =>
    dispatchAction<DeckShare[]>('deck.share', {
      deckId: deck.id,
      email: grantEmail,
      role: grantRole,
    })

  const addPerson = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    setShareError(null)
    try {
      setShares(await grant(email.trim(), role))
      setEmail('')
    } catch {
      setShareError('No account with that email')
    } finally {
      setBusy(false)
    }
  }

  const changeRole = (entry: DeckShare, nextRole: ShareRole) => {
    if (nextRole === entry.role) return
    grant(entry.email, nextRole)
      .then(setShares)
      .catch(() => {
        // Quiet failure: the row keeps its saved role
      })
  }

  const remove = (entry: DeckShare) => {
    dispatchAction<DeckShare[]>('deck.unshare', {
      deckId: deck.id,
      userId: entry.userId,
      role: entry.role,
    })
      .then(setShares)
      .catch(() => {
        // Quiet failure: the entry simply stays listed
      })
  }

  return (
    <section>
      <h3 className="mb-4 text-lg font-semibold text-slate-700">Access</h3>
      <div className="flex flex-col gap-6">
        <div>
          <h4 className="mb-2 text-sm font-medium text-slate-700">
            People with access
          </h4>
          <form
            onSubmit={e => void addPerson(e)}
            aria-label="Add people"
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="person@example.com"
              aria-label="Add people by email"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={role}
              onChange={e => setRole(e.target.value as ShareRole)}
              aria-label="Access role"
              className="rounded-md border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Add
            </button>
          </form>
          {shareError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {shareError}
            </p>
          )}
          <ul className="mt-3 flex flex-col gap-1">
            {shares.map(entry => (
              <li
                key={entry.userId}
                className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
              >
                <span className="font-medium">{entry.displayName}</span>
                <span className="truncate text-slate-500">{entry.email}</span>
                <select
                  value={entry.role}
                  onChange={e => changeRole(entry, e.target.value as ShareRole)}
                  aria-label={`Role for ${entry.displayName}`}
                  className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <button
                  aria-label={`Remove ${entry.displayName}`}
                  title="Remove access"
                  onClick={() => remove(entry)}
                  className="rounded p-1 text-slate-400 hover:text-red-600"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
            {shares.length === 0 && (
              <li className="text-sm text-slate-500">
                Only you have access so far.
              </li>
            )}
          </ul>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">
            General access
          </legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            {GENERAL_ACCESS.map(option => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-3 py-2 has-checked:border-indigo-400 has-checked:bg-indigo-50 sm:flex-1"
              >
                <input
                  type="radio"
                  name="General access"
                  value={option.value}
                  checked={deck.visibility === option.value}
                  onChange={() => setGeneralAccess(option.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  )
}
