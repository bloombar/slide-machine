/**
 * The one question a new account is asked (AUTH-6): student, educator, or
 * other. The answer chooses the privacy defaults the account's work starts
 * from — a student's profile and new lectures start private (P-1) — and it
 * is the only thing the answer does, so it can be changed later in Settings
 * without anything being locked in by it.
 *
 * Shown for as long as the account has no answer, which means accounts that
 * predate the question are asked once too. There is no dismiss and no
 * cancel: all three answers are valid, "Other" is the way past it for
 * someone who is neither, and a dismissable prompt would either ask again
 * every sign-in or quietly pick an answer for them.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ACCOUNT_TYPES,
  type AccountType,
  type SafeUser,
} from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { dispatchAction } from '../api/actions'
import { apiErrorMessage } from '../i18n/apiError'
import Modal from './Modal'

export default function AccountTypePrompt() {
  const { user, updateUser } = useAuth()
  const { t } = useTranslation()
  const [saving, setSaving] = useState<AccountType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLButtonElement>(null)

  // Answered, or nobody to ask. Anonymous callers never reach the
  // authenticated shell, but the check keeps this safe to render anywhere.
  if (!user || user.accountType) return null

  const choose = async (accountType: AccountType) => {
    setSaving(accountType)
    setError(null)
    try {
      updateUser(
        await dispatchAction<SafeUser>('user.setAccountType', { accountType }),
      )
      // No close: the answer lands on the user, and the guard above
      // unmounts this the moment it does.
    } catch (err) {
      setError(apiErrorMessage(err, t, 'onboarding.accountType.error'))
      setSaving(null)
    }
  }

  return (
    <Modal
      ariaLabelledBy="account-type-prompt-title"
      size="sm"
      // Nothing dismisses this but an answer.
      onClose={() => {}}
      closeOnEscape={false}
      initialFocusRef={firstRef}
    >
      <h2 id="account-type-prompt-title" className="text-lg font-bold">
        {t('onboarding.accountType.title')}
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        {t('onboarding.accountType.hint')}
      </p>
      {/* Test ids, not copy: the e2e suite answers this prompt on its way
          past, and every spec but one runs in a language whose wording it
          cannot know (docs/I18N.md). */}
      <div
        data-testid="account-type-prompt"
        className="mt-6 flex flex-col gap-2"
      >
        {ACCOUNT_TYPES.map((type, index) => (
          <button
            key={type}
            ref={index === 0 ? firstRef : undefined}
            data-account-type={type}
            onClick={() => void choose(type)}
            disabled={saving !== null}
            className="rounded-md border border-slate-300 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-60"
          >
            <span className="block">{t(`accountType.${type}.label`)}</span>
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              {t(`accountType.${type}.hint`)}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}
      <p className="mt-4 text-xs text-slate-500">
        {t('onboarding.accountType.changeable')}
      </p>
    </Modal>
  )
}
