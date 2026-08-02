/**
 * Everything about one account, in one place (AUTH-5 / SHARE-1 / BILL-4):
 * the public profile fields, the account's plan and what it has used, profile
 * visibility, and both languages. Signing out is not here — it lives in the
 * shell's hamburger menu, which every page carries.
 *
 * A full page at a canonical route rather than a modal, and rather than half
 * of it living on the profile page. Settings is somewhere you go and stay for
 * a while — reading usage bars, editing a bio, changing two different
 * languages — not a decision you make and dismiss. A page gives it a URL that
 * can be linked, bookmarked and reached with the back button, and it means
 * there is exactly one answer to "where do I change this?".
 *
 * `/app/settings` is your own; `/app/settings/:userId` is how an allowlisted
 * admin edits someone else's (ADMIN-5). The admin path confirms once on entry,
 * keeps a banner up for as long as the page is open, and writes an audit entry
 * per change. One control differs by design: the interface language is a plain
 * select when an admin sets it on someone else's account — LocaleSwitcher
 * changes the language of the app you are looking at, which is the owner's,
 * not the admin's.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  LOCALES,
  LOCALE_LABELS,
  type AdminUserSettingsPatch,
  type Locale,
  type ProfileVisibility,
  type SafeUser,
} from '@slide-machine/shared'
import { useAuth } from '../auth/AuthContext'
import { dispatchAction } from '../api/actions'
import { fetchAdminUser, updateAdminUserSettings } from '../api/admin'
import { ApiError } from '../api/http'
import { apiErrorMessage } from '../i18n/apiError'
import LocaleSwitcher from '../i18n/LocaleSwitcher'
import AdminEditNotice from '../components/AdminEditNotice'
import ConfirmDialog from '../components/ConfirmDialog'
import LanguageSelect from '../components/LanguageSelect'
import UsagePanel from '../components/UsagePanel'
import BillingPanel from '../components/BillingPanel'

/** One settings change, as the account itself holds it: an absent
 * `language` means "unchanged", an explicit `undefined` one means
 * "inherit the browser default". */
type AccountChange = Partial<
  Pick<SafeUser, 'profileVisibility' | 'locale' | 'language'>
>

/** The same change as the admin endpoint takes it. `JSON.stringify` drops
 * `undefined`, so clearing the language has to travel as an explicit
 * `null` — but only when the change touches the language at all. */
const wirePatch = (change: AccountChange): AdminUserSettingsPatch => ({
  ...change,
  ...('language' in change ? { language: change.language ?? null } : {}),
})

/** The public-profile fields, as edited. A field is absent until it is
 * touched, so the saved account is the single source for anything untouched
 * and a save landing elsewhere is never overwritten by stale form state. */
interface ProfileEdits {
  displayName?: string
  bio?: string
}

const textInputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm'

/** General is what the account *is*, Privacy is who may see it, Plan is what
 * it may spend. */
const TABS = ['general', 'privacy', 'plan'] as const
type SettingsTab = (typeof TABS)[number]

/** One titled group of controls, styled like the lecture and project settings
 * sheets so all three read as the same kind of screen. */
function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div>
      <h3 className="mb-2 text-lg font-semibold text-slate-700">{title}</h3>
      {hint && <p className="mb-3 text-sm text-slate-500">{hint}</p>}
      {children}
    </div>
  )
}

export default function AccountSettingsPage() {
  const { userId } = useParams<{ userId?: string }>()
  const { user: viewer, logout, updateUser } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()

  // No param means your own account. A param naming yourself is the same
  // account by a longer name, and is redirected below so the canonical URL
  // stays the short one.
  const adminUserId = userId && userId !== viewer?.id ? userId : undefined

  // The account an admin is editing. Holds the saved values too, so every
  // control shows what actually landed.
  const [target, setTarget] = useState<SafeUser | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // ADMIN-5 confirms on entry, once; until then the page shows nothing but
  // the question.
  const [confirmed, setConfirmed] = useState(false)

  // The tab is in the URL so it can be linked and returned to: the billing
  // provider sends the browser back here after checkout (BILL-2), and landing
  // on General would hide the very thing the user just paid for.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const tab: SettingsTab = TABS.includes(requestedTab as SettingsTab)
    ? (requestedTab as SettingsTab)
    : 'general'
  const setTab = (next: SettingsTab) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', next)
    // Replace, so a run along the tab strip does not fill the back button
    // with steps that all look like the same page.
    setSearchParams(params, { replace: true })
  }
  const tabRefs = useRef(new Map<SettingsTab, HTMLButtonElement>())
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [edits, setEdits] = useState<ProfileEdits>({})
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    if (!adminUserId || !confirmed) return
    let cancelled = false
    fetchAdminUser(adminUserId)
      .then(({ user }) => {
        if (!cancelled) setTarget(user)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [adminUserId, confirmed])

  const user = adminUserId ? target : viewer
  // Derived, not seeded by an effect: the field shows what you typed if you
  // typed, and what the account holds otherwise.
  const displayName = edits.displayName ?? user?.displayName ?? ''
  const bio = edits.bio ?? user?.bio ?? ''

  if (userId && userId === viewer?.id) {
    return <Navigate to="/app/settings" replace />
  }

  if (adminUserId && !confirmed) {
    return (
      <ConfirmDialog
        title={t('profile.adminSettings.title')}
        message={t('profile.adminSettings.messageGeneric')}
        confirmLabel={t('profile.adminSettings.confirm')}
        onConfirm={() => setConfirmed(true)}
        onCancel={() => navigate(-1)}
      />
    )
  }

  /** Left/Right on the tab list moves and focuses the adjacent tab. */
  const onTabKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const index = TABS.indexOf(tab)
    const next =
      TABS[
        (index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
      ]!
    setTab(next)
    tabRefs.current.get(next)?.focus()
  }

  /**
   * Closes the account. Soft, so it is recoverable during the retention
   * window (P-10) — but the session ends immediately, so the user is sent to
   * the public landing page rather than left holding a dead token.
   */
  const deleteAccount = async () => {
    setConfirmingDelete(false)
    setSaveError(null)
    try {
      await dispatchAction('user.deleteAccount')
      await logout()
      navigate('/')
    } catch (err) {
      setSaveError(apiErrorMessage(err, t, 'profile.errors.deleteAccount'))
    }
  }

  /** Saves one changed field of the admin's target account and folds it
   * in. Unlike the owner's quiet failures, a refusal here is reported —
   * the account is not the admin's, so a silent revert would mislead. */
  const saveAsAdmin = async (change: AccountChange) => {
    if (!adminUserId) return
    setSaveError(null)
    try {
      await updateAdminUserSettings(adminUserId, wirePatch(change))
      setTarget(current => (current ? { ...current, ...change } : current))
    } catch (err) {
      // The admin endpoint's refusals name the specific rule that was hit
      // ("Admin accounts cannot be moderated"), which is worth more to an
      // admin than a translated generic. The admin surfaces are English by
      // design (docs/I18N.md), so the raw message is shown as-is; the
      // owner's own paths below translate instead.
      setSaveError(
        err instanceof ApiError
          ? err.message
          : t('profile.errors.saveSettings'),
      )
    }
  }

  /**
   * Commits one profile field when you leave it — the text-field equivalent of
   * the save-as-you-go every other control here uses, and the same commit rule
   * as EditableText elsewhere in the app. Saving per keystroke would be a
   * request per letter; a Save button would make these two fields the only
   * ones on the page that need one.
   *
   * The owner's save refreshes the auth context, which is what the rest of the
   * app reads; the admin's goes through the audited endpoint and updates the
   * loaded copy.
   */
  const commitProfileField = async (field: keyof ProfileEdits) => {
    if (!user) return
    const typed = edits[field]
    if (typed === undefined) return // never focused, or already committed
    const value = field === 'displayName' ? typed.trim() : typed
    // An empty name would leave the account with nothing to be called, so it
    // is refused here rather than saved and blanked.
    if (field === 'displayName' && !value) {
      setProfileError(t('profile.displayNameRequired'))
      return
    }
    setProfileError(null)
    if (value === (user[field] ?? '')) {
      setEdits(current => ({ ...current, [field]: undefined }))
      return
    }
    const patch = { [field]: value }
    try {
      if (adminUserId) {
        // 204, so the local patch is what updates the page.
        await updateAdminUserSettings(adminUserId, patch)
        setTarget(current => (current ? { ...current, ...patch } : current))
      } else {
        updateUser(await dispatchAction<SafeUser>('user.updateProfile', patch))
      }
      setEdits(current => ({ ...current, [field]: undefined }))
    } catch (err) {
      setProfileError(apiErrorMessage(err, t, 'profile.errors.save'))
    }
  }

  const setLanguage = (language: Locale | null) => {
    if (adminUserId) {
      void saveAsAdmin({ language: language ?? undefined })
      return
    }
    dispatchAction<SafeUser>('user.setLanguage', { language })
      .then(updateUser)
      .catch(() => {
        // Quiet failure: the select reverts to the saved value
      })
  }

  const setLocale = (locale: Locale) => void saveAsAdmin({ locale })

  const toggleVisibility = () => {
    const profileVisibility: ProfileVisibility =
      user?.profileVisibility === 'public' ? 'private' : 'public'
    if (adminUserId) {
      void saveAsAdmin({ profileVisibility })
      return
    }
    dispatchAction<SafeUser>('user.setProfileVisibility', {
      profileVisibility,
    })
      .then(updateUser)
      .catch(() => {
        // Quiet failure: the toggle reverts to the saved value
      })
  }

  // Bare root: AppShell's <main> already supplies the page margins every
  // other page inherits. The inner column is narrowed for form legibility,
  // the same way the home page narrows its lecture list.
  return (
    <div>
      {/* Signing out lives only in the shell's hamburger menu now, so it is
          reachable from every page instead of just this one. */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t('common.settings')}</h1>
      </div>

      {adminUserId && <AdminEditNotice entity="account" />}

      {loadFailed && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {t('profile.errors.loadAccount')}
        </p>
      )}
      {!user && !loadFailed && (
        <p className="mt-4 text-sm text-slate-500">{t('common.loading')}</p>
      )}

      {user && (
        <div className="mt-6 max-w-2xl">
          {/* Two tabs, because the questions are different: General is what
              this account *is*, Plan is what it may spend. Mixing them meant
              scrolling past a bio to find out why a lecture stopped
              recording. */}
          <div
            role="tablist"
            aria-label={t('profile.sections')}
            onKeyDown={onTabKeyDown}
            className="mb-6 flex gap-1 border-b border-slate-200"
          >
            {TABS.map(name => (
              <button
                key={name}
                ref={el => {
                  if (el) tabRefs.current.set(name, el)
                }}
                role="tab"
                id={`settings-tab-${name}`}
                aria-selected={tab === name}
                aria-controls={`settings-panel-${name}`}
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setTab(name)}
                className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium ${
                  tab === name
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                {t(`profile.tabs.${name}`)}
              </button>
            ))}
          </div>

          {saveError && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {saveError}
            </p>
          )}

          {tab === 'general' && (
            <section
              role="tabpanel"
              id="settings-panel-general"
              aria-labelledby="settings-tab-general"
              className="flex flex-col gap-8"
            >
              <Section title={t('profile.accountSection')}>
                <p className="text-sm text-slate-600">{user.email}</p>
              </Section>

              {/* The public profile — the fields strangers see (SHARE-1).
                  Edited here rather than on the profile page itself: one
                  place to change a setting, whichever setting it is. */}
              <div>
                <h3 className="mb-2 text-lg font-semibold text-slate-700">
                  {t('profile.publicProfileSection')}
                </h3>
                <p className="mb-3 text-sm text-slate-500">
                  {t('profile.publicProfileSectionHint')}
                </p>
                <label
                  htmlFor="profile-display-name"
                  className="block text-sm font-medium text-slate-700"
                >
                  {t('profile.displayName')}
                </label>
                <input
                  id="profile-display-name"
                  value={displayName}
                  onChange={e =>
                    setEdits({ ...edits, displayName: e.target.value })
                  }
                  onBlur={() => void commitProfileField('displayName')}
                  className={`mt-1 ${textInputClass}`}
                />
                <label
                  htmlFor="profile-bio"
                  className="mt-4 block text-sm font-medium text-slate-700"
                >
                  {t('profile.bio')}
                </label>
                <textarea
                  id="profile-bio"
                  rows={4}
                  value={bio}
                  onChange={e => setEdits({ ...edits, bio: e.target.value })}
                  onBlur={() => void commitProfileField('bio')}
                  placeholder={t('profile.bioPlaceholder')}
                  className={`mt-1 ${textInputClass}`}
                />
                {profileError && (
                  <p role="alert" className="mt-2 text-sm text-red-600">
                    {profileError}
                  </p>
                )}
              </div>

              {/* Interface language (TECH-12), above the lecture language and
                  labelled so the two are never mistaken for each other. The
                  owner gets LocaleSwitcher, which re-renders the app they are
                  looking at; an admin gets a plain select, because the account
                  being changed is not the one on screen. */}
              <Section title={t('profile.languagesSection')}>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="account-locale"
                    className="text-sm font-medium text-slate-700"
                  >
                    {t('profile.interfaceLanguage')}
                  </label>
                  <p className="text-xs text-slate-500">
                    {t('profile.interfaceLanguageHint')}
                  </p>
                  {adminUserId ? (
                    <select
                      id="account-locale"
                      aria-label={t('profile.interfaceLanguage')}
                      value={user.locale}
                      onChange={e => setLocale(e.target.value as Locale)}
                      className="w-fit rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
                    >
                      {LOCALES.map(locale => (
                        <option key={locale} value={locale}>
                          {LOCALE_LABELS[locale]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <LocaleSwitcher id="account-locale" />
                  )}
                </div>

                <div className="mt-6 flex flex-col gap-1">
                  <p className="text-sm font-medium text-slate-700">
                    {t('profile.lectureLanguage')}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t('profile.lectureLanguageHint')}
                  </p>
                  <LanguageSelect
                    value={user.language}
                    defaultLabel={t('profile.lectureLanguageDefault', {
                      own: !adminUserId,
                    })}
                    onChange={setLanguage}
                  />
                </div>
              </Section>

              {/* Owner-only. An admin closing someone else's account goes
                  through the admin surfaces, where it is recorded against
                  them; offering it here would put a one-click deletion of
                  another person's work behind the same button as their bio. */}
              {!adminUserId && (
                <div className="rounded-md border border-red-200 p-4">
                  <h3 className="mb-2 text-lg font-semibold text-red-700">
                    {t('common.dangerZone')}
                  </h3>
                  <p className="mb-3 text-sm text-slate-600">
                    {t('profile.delete.hint')}
                  </p>
                  <button
                    onClick={() => setConfirmingDelete(true)}
                    className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    {t('profile.delete.action')}
                  </button>
                </div>
              )}
            </section>
          )}

          {tab === 'privacy' && (
            <section
              role="tabpanel"
              id="settings-panel-privacy"
              aria-labelledby="settings-tab-privacy"
              className="flex flex-col gap-8"
            >
              <Section
                title={t('profile.privacySection')}
                hint={t('profile.privacySectionHint')}
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={user.profileVisibility === 'public'}
                    onChange={toggleVisibility}
                    aria-label={t('profile.publicProfile')}
                  />
                  {t('profile.publicProfileHint', { own: !adminUserId })}
                </label>
              </Section>
            </section>
          )}

          {tab === 'plan' && (
            <section
              role="tabpanel"
              id="settings-panel-plan"
              aria-labelledby="settings-tab-plan"
              className="flex flex-col gap-8"
            >
              <Section title={t('profile.accountTypeSection')}>
                <p className="text-sm text-slate-600">
                  {t('profile.plan')}{' '}
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
                    {t(`plan.tier.${user.planTier}`, {
                      defaultValue: user.planTier,
                    })}
                  </span>
                </p>

                {/* Subscription state and the way to change it (BILL-2).
                    Owner-only for the same reason as usage below: it reports
                    the *caller's* own billing, and an admin looking at
                    someone else's account would be shown their own. */}
                {!adminUserId && (
                  <div className="mt-4">
                    <BillingPanel />
                  </div>
                )}
              </Section>

              {/* Usage against the plan's caps (BILL-4). Owner-only: the
                  action behind it reports the *caller's* own account, so
                  showing it while an admin edits someone else would print the
                  admin's numbers under another person's name. */}
              {!adminUserId && <UsagePanel />}
            </section>
          )}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={t('profile.delete.title')}
          message={t('profile.delete.message')}
          confirmLabel={t('profile.delete.action')}
          onConfirm={() => void deleteAccount()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}
