/**
 * Lecturing/generation language picker, shared by the profile, project
 * settings, and lecture settings. Nothing is stored until a language is
 * explicitly chosen; the "default" option clears the level so the value
 * cascades (lecture → project → profile → the speaker's browser). The
 * chosen language drives speech recognition and generated slide text.
 */
import { useTranslation } from 'react-i18next'
import { LOCALES, LOCALE_LABELS, type Locale } from '@slide-machine/shared'

interface Props {
  /** This level's own stored value; undefined = inherit. */
  value?: Locale
  /** What "inherit" means at this level, already translated by the call
   * site — e.g. "your project's setting". */
  defaultLabel: string
  onChange: (language: Locale | null) => void
}

export default function LanguageSelect({
  value,
  defaultLabel,
  onChange,
}: Props) {
  const { t } = useTranslation()
  return (
    <select
      aria-label={t('language.label')}
      value={value ?? ''}
      onChange={e => onChange((e.target.value || null) as Locale | null)}
      className="w-fit rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
    >
      <option value="">{t('language.inherit', { source: defaultLabel })}</option>
      {LOCALES.map(locale => (
        <option key={locale} value={locale}>
          {LOCALE_LABELS[locale]}
        </option>
      ))}
    </select>
  )
}
