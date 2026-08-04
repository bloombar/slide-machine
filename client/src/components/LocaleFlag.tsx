/**
 * Flag glyphs for the supported locales (SHARE-2).
 *
 * The viewer's slide-language menu shows a flag instead of a language name so
 * the control stays narrow in the nav. They are inline SVG rather than emoji:
 * Windows draws regional-indicator emoji as bare letters ("FR"), which is the
 * width the flags exist to save, and an inline glyph needs no network and no
 * font.
 *
 * A flag names a country and not a language — Spanish is spoken well beyond
 * Spain — so each one is the flag of the language's home country, and the
 * language's own name stays on the accessible name and tooltip of every
 * control that uses one. The flag is decoration; the name is the label.
 */
import type { ReactElement } from 'react'
import type { Locale } from '@slide-machine/shared'

/**
 * The points of a five-pointed star, so the Chinese flag's five are computed
 * rather than hand-typed. `aim` is the direction of the star's first point in
 * radians — straight up by default, and toward the big star for the small
 * ones that circle it.
 */
const star = (cx: number, cy: number, r: number, aim = -Math.PI / 2): string =>
  Array.from({ length: 10 }, (_, i) => {
    // Outer and inner vertices alternate; 0.382 is the five-pointed ratio
    const radius = i % 2 === 0 ? r : r * 0.382
    const angle = aim + (i * Math.PI) / 5
    const x = cx + radius * Math.cos(angle)
    const y = cy + radius * Math.sin(angle)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')

/** Direction from one of the small stars to the big one at (10, 10). */
const towardBigStar = (cx: number, cy: number): number =>
  Math.atan2(10 - cy, 10 - cx)

/** The four small stars of the Chinese flag: centre, then where they face. */
const SMALL_STARS = [
  [20, 4],
  [24, 8],
  [24, 14],
  [20, 18],
] as const

/** Flag artwork, all drawn 3:2 on a 60×40 grid. */
const FLAGS: Record<Locale, ReactElement> = {
  // Union Jack, drawn without the real flag's counterchange — the diagonals
  // are centred rather than offset, which is invisible at this size and
  // saves a lot of geometry.
  en: (
    <>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0L60 40M60 0L0 40" stroke="#FFFFFF" strokeWidth="8" />
      <path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" strokeWidth="4" />
      <path d="M30 0V40M0 20H60" stroke="#FFFFFF" strokeWidth="12" />
      <path d="M30 0V40M0 20H60" stroke="#C8102E" strokeWidth="7" />
    </>
  ),
  fr: (
    <>
      <rect width="60" height="40" fill="#FFFFFF" />
      <rect width="20" height="40" fill="#002395" />
      <rect x="40" width="20" height="40" fill="#ED2939" />
    </>
  ),
  // Spain without the coat of arms, which is unreadable at icon size
  es: (
    <>
      <rect width="60" height="40" fill="#AA151B" />
      <rect y="10" width="60" height="20" fill="#F1BF00" />
    </>
  ),
  ru: (
    <>
      <rect width="60" height="40" fill="#FFFFFF" />
      <rect y="13.33" width="60" height="13.33" fill="#0039A6" />
      <rect y="26.67" width="60" height="13.33" fill="#D52B1E" />
    </>
  ),
  zh: (
    <>
      <rect width="60" height="40" fill="#EE1C25" />
      <polygon points={star(10, 10, 6)} fill="#FFDE00" />
      {SMALL_STARS.map(([cx, cy]) => (
        <polygon
          key={`${cx}-${cy}`}
          points={star(cx, cy, 2, towardBigStar(cx, cy))}
          fill="#FFDE00"
        />
      ))}
    </>
  ),
}

interface Props {
  locale: Locale
  /** Size classes. The artwork is 3:2, so keep that ratio. */
  className?: string
}

/**
 * One locale's flag, decorative: it carries no accessible name, because the
 * control around it already says which language it means.
 */
export default function LocaleFlag({ locale, className = 'h-4 w-6' }: Props) {
  return (
    <svg
      viewBox="0 0 60 40"
      data-locale={locale}
      aria-hidden
      // A hairline ring so the white in a flag does not bleed into the white
      // menu behind it
      className={`shrink-0 rounded-[2px] ring-1 ring-slate-900/15 ${className}`}
    >
      {FLAGS[locale]}
    </svg>
  )
}
