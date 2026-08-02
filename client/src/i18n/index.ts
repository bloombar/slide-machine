/**
 * The i18next singleton (TECH-12). One module-level instance for the
 * whole app, so React components, non-React modules, and tests all read
 * the same translations without a provider in between.
 *
 * English ships eagerly in the main bundle: it is the fallback for every
 * other locale, so it is needed on any page load anyway. The other four
 * load as their own chunk on demand, which is why `initI18n` is async.
 */
import i18n from 'i18next'
import ICU from 'i18next-icu'
import resourcesToBackend from 'i18next-resources-to-backend'
import { initReactI18next } from 'react-i18next'
import { LOCALES, type Locale } from '@slide-machine/shared'
import en from './locales/en.json'
import { applyDocumentLocale } from './document'
import { clearStoredLocale, resolveInitialLocale, storeLocale } from './detect'

/** The app has one namespace; keys are grouped by dotted prefix instead. */
export const DEFAULT_NS = 'translation'

/**
 * Fetches a bundle on demand; Vite turns the template into a glob over
 * `./locales/*.json` and emits one chunk per locale, so adding a locale
 * is a file plus an entry in LOCALES and the direction map — nothing here.
 *
 * The glob also matches `en.json`, which is statically imported below, so
 * the build prints INEFFECTIVE_DYNAMIC_IMPORT for it. That is accurate and
 * intended: English belongs in the main chunk, and i18next never asks the
 * backend for a language it already has resources for.
 */
const lazyBundles = resourcesToBackend(
  (language: string) => import(`./locales/${language}.json`),
)

/**
 * Wires the singleton up and resolves once the initial locale's bundle
 * is loaded, so the first paint is already translated. Idempotent: the
 * app entry and the test setup can both call it, and a second call only
 * switches the language.
 */
export const initI18n = async (locale?: Locale): Promise<void> => {
  const initial = locale ?? resolveInitialLocale()
  if (i18n.isInitialized) {
    if (i18n.language !== initial) await i18n.changeLanguage(initial)
  } else {
    await i18n
      .use(ICU)
      .use(lazyBundles)
      .use(initReactI18next)
      .init({
        lng: initial,
        fallbackLng: 'en',
        supportedLngs: LOCALES,
        defaultNS: DEFAULT_NS,
        ns: [DEFAULT_NS],
        resources: { en: { [DEFAULT_NS]: en } },
        // English is bundled but the rest are not, so i18next must still
        // ask the backend for a locale it has no resources for.
        partialBundledLanguages: true,
        // React escapes what it renders; ICU handles its own arguments.
        interpolation: { escapeValue: false },
        returnNull: false,
        // Switching to a locale whose chunk is still loading would
        // otherwise suspend, and the app has no Suspense boundary above
        // the shell. Components re-render when the bundle lands instead.
        react: { useSuspense: false },
      })
  }
  applyDocumentLocale(initial)
}

/**
 * Shows the app in a locale, without touching what is remembered. For
 * applying a locale that was not just chosen — the account's stored
 * preference on sign-in, or the browser's language absent one.
 */
export const applyLocale = async (locale: Locale): Promise<void> => {
  if (i18n.language !== locale) await i18n.changeLanguage(locale)
  applyDocumentLocale(locale)
}

/**
 * Records an explicit choice and applies it: a locale is remembered for
 * the next visit's pre-auth paint, null forgets the choice and hands the
 * interface back to the browser's language. Persisting to the account is
 * the caller's job — see useLocale, which also dispatches
 * `user.setLocale` when signed in.
 */
export const changeLocale = async (locale: Locale | null): Promise<void> => {
  if (locale) storeLocale(locale)
  else clearStoredLocale()
  await applyLocale(locale ?? resolveInitialLocale())
}

/** Narrows any BCP-47 tag i18next reports to a supported locale. */
export const asLocale = (tag: string | undefined): Locale =>
  tag && (LOCALES as readonly string[]).includes(tag) ? (tag as Locale) : 'en'

/** The active interface language, always one of LOCALES. */
export const currentLocale = (): Locale => asLocale(i18n.language)

/**
 * Standalone translator for display strings outside the React tree (e.g.
 * lib/lecture.ts). Components use `useTranslation` instead, which also
 * re-renders them when the language changes.
 */
export const t = (key: string, values?: Record<string, unknown>): string =>
  i18n.t(key, values)

export { i18n }
