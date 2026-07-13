/**
 * Lecturing/generation language picker, shared by the profile, project
 * settings, and lecture settings. Nothing is stored until a language is
 * explicitly chosen; the "default" option clears the level so the value
 * cascades (lecture → project → profile → the speaker's browser). The
 * chosen language drives speech recognition and generated slide text.
 */
import { LOCALES, LOCALE_LABELS, type Locale } from '@slide-machine/shared'

interface Props {
  /** This level's own stored value; undefined = inherit. */
  value?: Locale
  /** What "inherit" means at this level, e.g. "Project setting". */
  defaultLabel: string
  onChange: (language: Locale | null) => void
}

export default function LanguageSelect({
  value,
  defaultLabel,
  onChange,
}: Props) {
  return (
    <select
      aria-label="Language"
      value={value ?? ''}
      onChange={e => onChange((e.target.value || null) as Locale | null)}
      className="w-fit rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
    >
      <option value="">Default — {defaultLabel}</option>
      {LOCALES.map(locale => (
        <option key={locale} value={locale}>
          {LOCALE_LABELS[locale]}
        </option>
      ))}
    </select>
  )
}
