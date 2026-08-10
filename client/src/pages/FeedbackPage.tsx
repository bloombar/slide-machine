/**
 * "Send feedback" — a bug report, a feature request, or anything else, mailed
 * to the address the server is configured with. Nothing is stored, so there
 * is nothing to come back and read: the page's whole job is to get one
 * message out and say that it went.
 *
 * Reachable signed out, on purpose. Someone who cannot sign in is exactly the
 * person with something to tell us, so the form asks for an address to reply
 * to; a signed-in sender is identified by the server from their token and is
 * not asked again.
 *
 * English only, like the other static pages (see content/document.ts).
 */
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { Send } from 'lucide-react'
import {
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  type FeedbackKind,
} from '@slide-machine/shared'
import { sendFeedback } from '../api/feedback'
import { ApiError } from '../api/http'
import { useAuth } from '../auth/AuthContext'
import { getFeedbackEnabled } from '../runtime-config'

/** The three kinds, in the order they are offered, with the wording the
 * sender sees. `other` is last because it is the catch-all. */
const KINDS: { value: FeedbackKind; label: string; hint: string }[] = [
  {
    value: 'bug',
    label: 'Something is broken',
    hint: 'A bug report — what you did, and what happened instead.',
  },
  {
    value: 'feature',
    label: 'Something is missing',
    hint: 'A feature request, or a rough edge worth smoothing.',
  },
  {
    value: 'other',
    label: 'Something else',
    hint: 'Praise, criticism, a question — anything at all.',
  },
]

/**
 * The app's standard content column (AppShell's main, ProfilePage), so this
 * page starts where every other page does. The form itself is held to the
 * narrower measure account settings uses for its own field blocks — a text
 * input a thousand pixels wide is not easier to fill in.
 */
const PAGE_CLASS = 'mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8'
const CONTENT_CLASS = 'max-w-2xl'

const FIELD_CLASS =
  'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none'
const LABEL_CLASS = 'block text-sm font-medium text-slate-700'

export default function FeedbackPage() {
  const { user } = useAuth()
  const location = useLocation()
  /** Where the sender came from, handed over by the menu link so a bug
   * report carries the page it is about. */
  const from = (location.state as { from?: string } | null)?.from

  // `?kind=` lets a link elsewhere open the form on the right question — the
  // usage prompts send a Max account here already set to "Something else".
  // A query param rather than router state, because the same link is mailed.
  // Only the initial value: having chosen it for the sender once, the radios
  // are theirs to change.
  const [searchParams] = useSearchParams()
  const requestedKind = searchParams.get('kind')
  const [kind, setKind] = useState<FeedbackKind>(
    FEEDBACK_KINDS.includes(requestedKind as FeedbackKind)
      ? (requestedKind as FeedbackKind)
      : 'bug',
  )
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // A server with no mail transport, or no address to send to, has no use for
  // the form — and the menu leaves the link out for the same reason.
  if (!getFeedbackEnabled()) {
    return (
      <div className={PAGE_CLASS}>
        <h1 className="text-3xl font-bold tracking-tight">Send feedback</h1>
        <p className={`mt-4 text-slate-600 ${CONTENT_CLASS}`}>
          Feedback is not set up on this server, so there is nowhere for this
          form to send. If you are running it yourself, set{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-sm">
            FEEDBACK_EMAIL
          </code>{' '}
          and a mail transport in the server configuration.
        </p>
      </div>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await sendFeedback({
        kind,
        subject: subject.trim(),
        message: message.trim(),
        // The server prefers a signed-in sender's account address; sending
        // this too would only add a line to the email saying the same thing.
        ...(user || !email.trim() ? {} : { email: email.trim() }),
        ...(from ? { page: from } : {}),
      })
      setSent(true)
    } catch (err) {
      // The API's own wording is already the clearest thing available here —
      // it is the side that knows whether mail is down or the caller is
      // simply sending too fast.
      setError(
        err instanceof ApiError
          ? err.message
          : 'Your message could not be sent. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  /** Back to an empty form, for a sender with a second thing to say. */
  const reset = () => {
    setSubject('')
    setMessage('')
    setSent(false)
  }

  if (sent) {
    return (
      <div className={PAGE_CLASS}>
        <h1 className="text-3xl font-bold tracking-tight">Thank you</h1>
        <p role="status" className={`mt-4 text-slate-600 ${CONTENT_CLASS}`}>
          Your message is on its way. A person reads these — if you left us an
          address, you may well hear back.
        </p>
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={reset}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Send another
          </button>
          <Link
            to={from ?? '/'}
            className="text-sm text-slate-500 hover:text-slate-900"
          >
            Back to where you were
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className={PAGE_CLASS}>
      <h1 className="text-3xl font-bold tracking-tight">Send feedback</h1>
      <p className={`mt-2 text-slate-600 ${CONTENT_CLASS}`}>
        Tell us what is broken, what is missing, or what you think. It goes
        straight to the people who build this.
      </p>

      <form onSubmit={submit} className={`mt-8 space-y-6 ${CONTENT_CLASS}`}>
        <fieldset>
          <legend className={LABEL_CLASS}>What kind of feedback is it?</legend>
          <div className="mt-2 space-y-2">
            {KINDS.map(option => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 hover:bg-slate-50 has-checked:border-indigo-400 has-checked:bg-indigo-50"
              >
                <input
                  type="radio"
                  name="kind"
                  value={option.value}
                  checked={kind === option.value}
                  onChange={() => setKind(option.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">
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

        <div>
          <label htmlFor="feedback-subject" className={LABEL_CLASS}>
            Summary
          </label>
          <input
            id="feedback-subject"
            required
            maxLength={200}
            value={subject}
            onChange={event => setSubject(event.target.value)}
            placeholder="One line — what this is about"
            className={FIELD_CLASS}
          />
        </div>

        <div>
          <label htmlFor="feedback-message" className={LABEL_CLASS}>
            Details
          </label>
          <textarea
            id="feedback-message"
            required
            rows={8}
            maxLength={FEEDBACK_MESSAGE_MAX}
            value={message}
            onChange={event => setMessage(event.target.value)}
            aria-describedby="feedback-message-hint"
            placeholder="What you did, what you expected, and what happened instead."
            className={FIELD_CLASS}
          />
          <p id="feedback-message-hint" className="mt-1 text-xs text-slate-500">
            {message.length} of {FEEDBACK_MESSAGE_MAX} characters.
          </p>
        </div>

        {user ? (
          <p className="text-xs text-slate-500">
            Sent from your account, {user.displayName}. We will reply to the
            address it is registered with.
          </p>
        ) : (
          <div>
            <label htmlFor="feedback-email" className={LABEL_CLASS}>
              Your email <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="feedback-email"
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              aria-describedby="feedback-email-hint"
              placeholder="you@example.com"
              className={FIELD_CLASS}
            />
            <p id="feedback-email-hint" className="mt-1 text-xs text-slate-500">
              Only so we can reply. Leave it blank to stay anonymous.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden />
            {busy ? 'Sending…' : 'Send feedback'}
          </button>
          <p className="text-xs text-slate-500">
            Handled as described in our{' '}
            <Link
              to="/privacy"
              className="underline underline-offset-2 hover:text-slate-900"
            >
              privacy policy
            </Link>
            .
          </p>
        </div>
      </form>
    </div>
  )
}
