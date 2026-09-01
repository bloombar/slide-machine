/**
 * The one-line "by continuing you agree to…" notice under the sign-in and
 * register forms, linking the two legal documents.
 *
 * It sits on the pages where an account is actually created — including via
 * "Continue with Google", which is where an OAuth grant begins — so the terms
 * and the privacy policy are named at the moment they start to apply rather
 * than only in a menu. Google's OAuth homepage requirements ask for the
 * privacy link to be reachable without logging in; this is the copy of it
 * closest to the decision (docs/GOOGLE_PRODUCTION_MODE.md §3.3).
 */
import { Trans } from 'react-i18next'
import { Link } from 'react-router'

const LINK_CLASS = 'text-indigo-600 underline underline-offset-2'

export default function LegalConsentNotice({
  /** Which verb the sentence uses — creating an account, or signing in. */
  action,
}: {
  action: 'register' | 'signIn'
}) {
  return (
    <p className="text-xs leading-5 text-slate-500">
      <Trans
        i18nKey={
          action === 'register' ? 'auth.legalRegister' : 'auth.legalSignIn'
        }
        components={{
          termsLink: <Link to="/terms" className={LINK_CLASS} />,
          privacyLink: <Link to="/privacy" className={LINK_CLASS} />,
        }}
      />
    </p>
  )
}
