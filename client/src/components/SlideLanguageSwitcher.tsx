/**
 * Slide-content language picker for the deck viewer (SHARE-2).
 *
 * Distinct from the interface-language switcher (TECH-12): that one changes
 * the app's buttons and menus, this one changes the words on the slides. The
 * two never appear together — NavLocaleSwitcher lives on the landing and
 * sign-in pages — but the accessible names still say which is which, because
 * a reader who meets one of them has no way to guess.
 *
 * Trigger and rows show a flag rather than a language name. The control sits
 * in the deck viewer's nav beside the view toggle, settings and share, where
 * "Original (Français)" spent more width than the rest of that row put
 * together. The language's own name is still one hover away — it is the
 * tooltip, and the accessible name — so nothing is lost to a screen reader or
 * to anyone who does not read a flag at a glance.
 *
 * The deck's own language leads the list and wears a black dot. It is marked
 * rather than left implicit because a machine translation is a reading aid
 * and the authored text is what the lecture actually says — knowing which one
 * you are looking at matters. Choosing it means "show the original", which is
 * why it reports null rather than its locale.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Check, Loader2 } from 'lucide-react'
import { LOCALES, localeShortLabel, type Locale } from '@slide-machine/shared'
import LocaleFlag from './LocaleFlag'
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

  // The deck's own language first, then every other one. Its row stands for
  // the original, so no language is ever offered twice.
  const options: Locale[] = [source, ...LOCALES.filter(l => l !== source)]
  const original = t('viewer.slideLanguageOriginal', {
    language: localeShortLabel(source),
  })
  const current = value ? localeShortLabel(value) : original

  return (
    <div ref={ref} className="relative">
      {/* The tooltip names the language on screen, since the trigger itself
          no longer spells it out */}
      <Tooltip label={current}>
        <button
          aria-label={`${t('viewer.slideLanguage')}: ${current}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          <LocaleFlag locale={value ?? source} />
          {/* The spinner takes the chevron's place rather than the flag's, so
              fetching a translation does not change the control's width */}
          {busy ? (
            <Loader2
              className="h-4 w-4 shrink-0 animate-spin text-slate-500"
              aria-hidden
            />
          ) : (
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          )}
        </button>
      </Tooltip>
      {open && (
        // Anchored to the trigger's inline-end: this sits near the edge of
        // the nav, so a start-aligned menu would overflow the page. It is as
        // wide as its rows, which is not much now that they are flags.
        <div
          role="menu"
          aria-label={t('viewer.slideLanguage')}
          className="absolute top-full end-0 z-50 mt-1 w-max rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          {options.map(option => {
            const isSource = option === source
            // The deck's own language is checked when nothing is translated
            const active = isSource ? value === null : value === option
            return (
              <button
                key={option}
                role="menuitemradio"
                aria-checked={active}
                // Flags carry no text, so this is the row's only label —
                // for assistive tech and for the hover title alike
                aria-label={isSource ? original : localeShortLabel(option)}
                title={isSource ? original : localeShortLabel(option)}
                onClick={() => choose(isSource ? null : option)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100"
              >
                <LocaleFlag locale={option} />
                {/* The slot is always rendered, so the checks beside it line
                    up whether or not a row is the deck's own language */}
                <span className="flex w-1.5 justify-center">
                  {isSource && (
                    <span
                      aria-hidden
                      data-testid="default-language-dot"
                      className="h-1.5 w-1.5 rounded-full bg-slate-900"
                    />
                  )}
                </span>
                <Check
                  className={`h-4 w-4 shrink-0 text-indigo-600 ${active ? '' : 'invisible'}`}
                  aria-hidden
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
