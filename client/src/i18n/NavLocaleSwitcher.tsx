/**
 * Interface-language picker for the public nav bar (TECH-12).
 *
 * The switcher's home is the account settings modal, which signed-out
 * visitors never reach — so the three pages they can land on without an
 * account (landing, sign-in, sign-up) portal this copy into the public
 * shell's right-hand action area via ShellActions.
 *
 * This one does not reuse LocaleSwitcher's <select>. A native select's
 * open list is drawn by the OS and cannot be styled, which looks nothing
 * like the rest of the app; the account settings modal keeps the select,
 * where a form field is what belongs. Here the menu is ours, built to
 * match the hamburger's dropdown, and the trigger reads as nav chrome:
 * transparent until hovered, like the other ghost controls beside it.
 *
 * Every language is named in itself and nothing else — "Français", not
 * "Français (French)". A reader looking for their own language scans for
 * the word they already know, so the English gloss `LOCALE_LABELS`
 * carries adds length without adding a way in. The gloss remains on the
 * account settings select.
 *
 * The first entry is the default — no stored choice, the browser's
 * language decides — and it is what stays checked until a visitor picks
 * a language themselves. The trigger still names the language actually
 * on screen, since that is what the reader is looking at.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Languages, ChevronDown, Check } from 'lucide-react'
import { LOCALES, localeShortLabel, type Locale } from '@slide-machine/shared'
import { ShellActions } from '../components/layout/ShellActions'
import { useLocale } from './useLocale'

export default function NavLocaleSwitcher() {
  const { locale, preference, setLocale } = useLocale()
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Same dismissal contract as the hamburger: outside click or Escape
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
    setLocale(next)
    setOpen(false)
  }

  return (
    <ShellActions>
      <div ref={ref} className="relative">
        <button
          // Names the control and reads out the current choice, the way
          // the select it replaces did
          aria-label={`${t('profile.interfaceLanguage')}: ${localeShortLabel(locale)}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          <Languages className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          {localeShortLabel(locale)}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {open && (
          // Anchored to the trigger's inline-end: this sits at the edge
          // of the nav, so a start-aligned menu would overflow the page
          <div
            role="menu"
            aria-label={t('profile.interfaceLanguage')}
            className="absolute top-full end-0 z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
          >
            <button
              role="menuitemradio"
              aria-checked={preference === null}
              onClick={() => choose(null)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-slate-100 ${
                preference === null
                  ? 'font-medium text-indigo-600'
                  : 'text-slate-700'
              }`}
            >
              {t('language.inherit', {
                source: t('profile.interfaceLanguageDefault', { own: true }),
              })}
              {preference === null && (
                <Check className="h-4 w-4 shrink-0" aria-hidden />
              )}
            </button>
            {LOCALES.map(option => {
              const active = option === preference
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
    </ShellActions>
  )
}
