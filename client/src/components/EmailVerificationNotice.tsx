/**
 * Whether this account has confirmed its address, and the way to fix it if
 * not (AUTH-3).
 *
 * Sits beside the address in account settings rather than shouting from a
 * banner: an unconfirmed account works perfectly well for everything except
 * publishing to everyone, so this is a note, not an alarm. The one place it
 * bites — trying to publish — says so at that moment.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resendVerification } from '../api/auth'
import { getMailEnabled } from '../runtime-config'

export default function EmailVerificationNotice({
  email,
  verified,
}: {
  email: string
  verified: boolean
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  )

  if (verified) {
    return (
      <p className="text-sm text-emerald-700">{t('auth.verify.confirmed')}</p>
    )
  }

  const mailEnabled = getMailEnabled()

  const send = () => {
    setState('sending')
    resendVerification()
      .then(result => setState(result.sent ? 'sent' : 'error'))
      .catch(() => setState('error'))
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-slate-700">
        {t('auth.verify.pendingTitle')}
      </p>
      <p className="text-sm text-slate-600">
        {t('auth.verify.pending', { email })}
      </p>
      {!mailEnabled ? (
        <p role="status" className="text-sm text-amber-700">
          {t('auth.verify.unavailable')}
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={send}
            disabled={state === 'sending'}
            className="self-start rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {state === 'sending'
              ? t('auth.verify.resending')
              : t('auth.verify.resend')}
          </button>
          {state === 'sent' && (
            <span role="status" className="text-sm text-slate-600">
              {t('auth.verify.resent')}
            </span>
          )}
          {state === 'error' && (
            <span role="alert" className="text-sm text-red-600">
              {t('auth.verify.resendError')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
