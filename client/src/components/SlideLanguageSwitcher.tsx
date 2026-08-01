/**
 * Slide-content language picker for the deck viewer (SHARE-2).
 *
 * Distinct from the interface-language switcher (TECH-12): that one changes
 * the app's buttons and menus, this one changes the words on the slides. The
 * two never appear together — NavLocaleSwitcher lives on the landing and
 * sign-in pages — but the labels still say which is which, because a reader
 * who meets one of them has no way to guess.
 *
 * "Original" is the deck's own language and always leads the list. It is
 * named, not left implicit, because a machine translation is a reading aid
 * and the authored text is what the lecture actually says — knowing which one
 * you are looking at matters.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Languages, ChevronDown, Check, Loader2 } from 'lucide-react'
import { LOCALES, localeShortLabel, type Locale } from '@slide-machine/shared'
import Tooltip from './Tooltip'

interface Props {
  /** The deck's authored language — the "Original" entry. */
  source: Locale
  /** The language shown now, or null while showing the original. */
  value: Locale | null
  onChange: (locale: Locale | null) => void
  /** True while a translation is being fetched. */
  busy?: boolean
}

export default function SlideLanguageSwitcher({
  source,
  value,
  onChange,
  busy = false,
}: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Same dismissal contract as the other nav menus: outside click or Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (next: Locale | null) => {
    onChange(next)
    setOpen(false)
  }

  // Every locale but the deck's own — asking for the language it is already
  // in is what "Original" is for.
  const targets = LOCALES.filter(l => l !== source)
  const current = value
    ? localeShortLabel(value)
    : t('viewer.slideLanguageOriginal', { language: localeShortLabel(source) })

  return (
    <div ref={ref} className="relative">
      <Tooltip label={t('viewer.slideLanguage')}>
        <button
          aria-label={`${t('viewer.slideLanguage')}: ${current}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          {busy ? (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin text-slate-500"
              aria-hidden
            />
          ) : (
            <Languages
              className="h-4 w-4 shrink-0 text-slate-500"
              aria-hidden
            />
          )}
          {current}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
      </Tooltip>
      {open && (
        // Anchored to the trigger's inline-end: this sits near the edge of
        // the nav, so a start-aligned menu would overflow the page
        <div
          role="menu"
          aria-label={t('viewer.slideLanguage')}
          className="absolute top-full end-0 z-50 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          <button
            role="menuitemradio"
            aria-checked={value === null}
            onClick={() => choose(null)}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-slate-100 ${
              value === null ? 'font-medium text-indigo-600' : 'text-slate-700'
            }`}
          >
            {t('viewer.slideLanguageOriginal', {
              language: localeShortLabel(source),
            })}
            {value === null && (
              <Check className="h-4 w-4 shrink-0" aria-hidden />
            )}
          </button>
          {targets.map(option => {
            const active = option === value
            return (
              <button
                key={option}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => choose(option)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-slate-100 ${
                  active ? 'font-medium text-indigo-600' : 'text-slate-700'
                }`}
              >
                {localeShortLabel(option)}
                {active && <Check className="h-4 w-4 shrink-0" aria-hidden />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
