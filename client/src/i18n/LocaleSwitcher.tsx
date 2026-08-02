/**
 * Interface-language picker (TECH-12) — the control that changes what
 * language the app itself is shown in. Takes effect immediately.
 *
 * Deliberately not LanguageSelect, which picks the *lecturing* language:
 * the two cascade differently and are labelled apart. The default option
 * is the same idea, though — nothing is stored until a language is
 * picked, and returning to the default stores nothing again, leaving the
 * interface to follow the browser.
 *
 * Language names stay in their own language (LOCALE_LABELS), which is
 * what a reader looking for their own language expects to find.
 */
import { useTranslation } from 'react-i18next'
import { LOCALES, LOCALE_LABELS, type Locale } from '@slide-machine/shared'
import { useLocale } from './useLocale'

interface Props {
  /** Ties the select to a visible label rendered by the caller. */
  id?: string
  className?: string
}

const selectClass =
  'w-fit rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700'

export default function LocaleSwitcher({ id, className }: Props) {
  const { t } = useTranslation()
  const { preference, setLocale } = useLocale()

  return (
    <select
      id={id}
      aria-label={t('profile.interfaceLanguage')}
      // The stored choice, not the effective locale: the default option
      // stays selected while the browser's language is what shows
      value={preference ?? ''}
      onChange={e => setLocale((e.target.value || null) as Locale | null)}
      className={className ?? selectClass}
    >
      <option value="">
        {t('language.inherit', {
          source: t('profile.interfaceLanguageDefault', { own: true }),
        })}
      </option>
      {LOCALES.map(option => (
        <option key={option} value={option}>
          {LOCALE_LABELS[option]}
        </option>
      ))}
    </select>
  )
}
