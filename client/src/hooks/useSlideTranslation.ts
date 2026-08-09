/**
 * The deck viewer's slide-content language (SHARE-2): which language the
 * slides are being read in, and the translated text for it.
 *
 * The choice is remembered in localStorage rather than on the account, the
 * same way the view mode is: it belongs to how someone is reading right now,
 * and the anonymous permalink visitors this feature exists for have no
 * account to store it on. It is keyed per deck — reading one lecture in
 * Spanish says nothing about the next one.
 *
 * `busy` and `failed` are derived from which locale the loaded result belongs
 * to rather than tracked as their own state, so there is no window where the
 * hook reports one language while holding another's words. Switching back to
 * a language already loaded is therefore instant.
 *
 * Nothing here writes to the deck. The translation is fetched, held beside
 * the slides, and laid over them at render time; the stored slides are never
 * touched, so the authored text stays authoritative.
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  DeckTranslationResponse,
  Locale,
  SlideTranslationEntry,
} from '@slide-machine/shared'
import { isLocale } from '@slide-machine/shared'
import { ApiError, apiFetch } from '../api/http'

const STORAGE_PREFIX = 'sm:slide-language:'

const storageKey = (slug: string): string => `${STORAGE_PREFIX}${slug}`

/** The remembered language for this deck, or null to read the original. */
const readStored = (
  slug: string | undefined,
  enabled: boolean,
): Locale | null => {
  if (!slug || !enabled) return null
  try {
    const raw = localStorage.getItem(storageKey(slug))
    return isLocale(raw) ? raw : null
  } catch {
    // A browser with storage blocked still gets a working switcher, it
    // just forgets the choice on reload.
    return null
  }
}

const writeStored = (slug: string, locale: Locale | null): void => {
  try {
    if (locale) localStorage.setItem(storageKey(slug), locale)
    else localStorage.removeItem(storageKey(slug))
  } catch {
    // Ignored — see readStored
  }
}

/** A fetched translation, tagged with the language it is for. */
interface Loaded {
  locale: Locale
  perSlide: Record<string, SlideTranslationEntry>
}

export interface SlideTranslationState {
  /** The language being read, or null while showing the authored text. */
  locale: Locale | null
  setLocale: (locale: Locale | null) => void
  /** Translated text by slide id; empty while showing the original, and
   * while another language is still loading. */
  perSlide: Record<string, SlideTranslationEntry>
  busy: boolean
  /** Set when a translation could not be fetched; the viewer stays on the
   * original text rather than showing a half-translated deck. */
  failed: boolean
  /**
   * The server's explanation when the failure was an exhausted plan allowance
   * (402, BILL-4) rather than a provider outage. Carried because the two need
   * different words: an outage says "try again", a spent allowance says what
   * ran out, and only the second has anything the reader can act on.
   *
   * Safe to show to anyone — the server already writes a viewer-safe message
   * for audience requests that reveals nothing about the owner's billing —
   * but the viewer shows it only to editors, who are the ones who can act.
   */
  limitMessage: string | null
}

export function useSlideTranslation(
  slug: string | undefined,
  enabled: boolean,
): SlideTranslationState {
  const [locale, setLocaleState] = useState<Locale | null>(() =>
    readStored(slug, enabled),
  )
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failedLocale, setFailedLocale] = useState<Locale | null>(null)
  const [limitMessage, setLimitMessage] = useState<string | null>(null)

  // Opening a different deck restores that deck's own remembered language.
  // Adjusted during render (React's documented pattern for state that
  // depends on props) rather than in an effect, which would paint one
  // deck's choice onto another for a frame.
  const [lastSlug, setLastSlug] = useState(slug)
  if (slug !== lastSlug) {
    setLastSlug(slug)
    setLocaleState(readStored(slug, enabled))
    setLoaded(null)
    setFailedLocale(null)
    setLimitMessage(null)
  }

  const loadedLocale = loaded?.locale
  useEffect(() => {
    // Nothing to fetch for the authored text, and nothing to re-fetch for a
    // language already in hand.
    if (!slug || !enabled || !locale || loadedLocale === locale) return
    let cancelled = false
    apiFetch<DeckTranslationResponse>(`/api/decks/${slug}/translation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale }),
    })
      .then(res => {
        if (!cancelled) {
          setLoaded({ locale, perSlide: res.perSlide })
          setLimitMessage(null)
        }
      })
      .catch((error: unknown) => {
        // Fall back to the authored text: a lecture nobody can read is worse
        // than a lecture in the wrong language.
        if (cancelled) return
        setFailedLocale(locale)
        setLimitMessage(
          error instanceof ApiError && error.status === 402
            ? error.message
            : null,
        )
      })
    return () => {
      cancelled = true
    }
  }, [slug, enabled, locale, loadedLocale])

  const setLocale = useCallback(
    (next: Locale | null) => {
      setLocaleState(next)
      // Clear the last failure so choosing the same language again retries.
      setFailedLocale(null)
      setLimitMessage(null)
      if (slug) writeStored(slug, next)
    },
    [slug],
  )

  const failed = locale !== null && failedLocale === locale
  return {
    locale,
    setLocale,
    // Only ever hand back words that belong to the language being asked for.
    perSlide: locale && loadedLocale === locale ? loaded!.perSlide : {},
    busy: locale !== null && !failed && loadedLocale !== locale,
    failed,
    limitMessage: failed ? limitMessage : null,
  }
}
