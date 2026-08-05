/**
 * Slide-content language picker for the deck viewer (SHARE-2).
 *
 * Distinct from the interface-language switcher (TECH-12): that one changes
 * the app's buttons and menus, this one changes the words on the slides. The
 * two never appear together — NavLocaleSwitcher lives on the landing and
 * sign-in pages — but the accessible names still say which is which, because
 * a reader who meets one of them has no way to guess.
 *
 * The trigger is the languages icon and nothing else — the same glyph the
 * interface-language picker wears, since both mean "pick a language". It sits
 * in the deck viewer's nav beside the view toggle, settings and share, where
 * "Original (Français)" spent more width than the rest of that row put
 * together; the language on screen stays one hover away, as the tooltip and
 * the accessible name. The menu it opens has the room to spell things out, so
 * every row is a language's name in that language, with a check on the one
 * being read — the same menu the interface-language picker offers.
 *
 * The deck's own language leads the list, named as the original rather than
 * left implicit: a machine translation is a reading aid and the authored text
 * is what the lecture actually says, so knowing which one you are looking at
 * matters. Choosing it means "show the original", which is why it reports
 * null rather than its locale.
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
          <Languages className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          {/* The spinner takes the chevron's place rather than the icon's, so
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
        // wide as its longest row and no wider — five language names do not
        // need a fixed column to sit in.
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
                onClick={() => choose(isSource ? null : option)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-slate-100 ${
                  active ? 'font-medium text-indigo-600' : 'text-slate-700'
                }`}
              >
                {isSource ? original : localeShortLabel(option)}
                {/* The check is always rendered, so the menu is the same
                    width whichever language is being read */}
                <Check
                  className={`h-4 w-4 shrink-0 ${active ? '' : 'invisible'}`}
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
