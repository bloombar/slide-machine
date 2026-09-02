/**
 * The "sign in on the spot" dialog (AUTH-8). Playback, spoken narration, and
 * translated viewing all need an account; a signed-out visitor reaching for
 * any of them gets this instead of the action, told which one it was for,
 * and can sign in without leaving the page — carrying everything `/login`
 * carries (Google included), via the shared `SignInForm`.
 *
 * General on purpose: it takes only which feature was reached for, so any
 * page can raise it without knowing about the others. Closing on success is
 * the whole of what it does — it never fires the action that was reached
 * for, since a login form making audio start by itself would be a surprise.
 * The caller's own state (e.g. `useAuth()`'s `user`) is what makes the
 * gated control live again, and re-pressing it is the visitor's to do.
 */
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from './Modal'
import SignInForm from './SignInForm'

/** The small, typed set of things a signed-out visitor can reach for that
 * need an account — kept closed rather than a free string, so every call
 * site names one of these three and the copy for each lives in one place. */
export type AuthGateFeature = 'playback' | 'narration' | 'translation'

const TITLE_KEY: Record<AuthGateFeature, string> = {
  playback: 'auth.gate.playback',
  narration: 'auth.gate.narration',
  translation: 'auth.gate.translation',
}

interface Props {
  feature: AuthGateFeature
  onClose: () => void
}

export default function SignInDialog({ feature, onClose }: Props) {
  const { t } = useTranslation()
  const emailRef = useRef<HTMLInputElement>(null)
  const title = t(TITLE_KEY[feature])

  return (
    <Modal ariaLabel={title} onClose={onClose} initialFocusRef={emailRef}>
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="mt-4">
        <SignInForm emailInputRef={emailRef} onSuccess={onClose} />
      </div>
    </Modal>
  )
}
