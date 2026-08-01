/**
 * Interface-language picker (TECH-12) — the control that changes what
 * language the app itself is shown in.
 *
 * Deliberately not LanguageSelect, which picks the *lecturing* language
 * and offers an "inherit" option. There is always an effective interface
 * locale, so this one has no such option and takes effect immediately.
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
  const { locale, setLocale } = useLocale()

  return (
    <select
      id={id}
      aria-label={t('profile.interfaceLanguage')}
      value={locale}
      onChange={e => setLocale(e.target.value as Locale)}
      className={className ?? selectClass}
    >
      {LOCALES.map(option => (
        <option key={option} value={option}>
          {LOCALE_LABELS[option]}
        </option>
      ))}
    </select>
  )
}
