/**
 * Public landing page — the app's homepage, and the page Google's OAuth
 * reviewers read (docs/GOOGLE_PRODUCTION_MODE.md §3.3). It therefore does
 * three jobs beyond looking like a front door:
 *
 * - identifies the app and its brand;
 * - describes what the app actually does, in enough detail to be a
 *   description rather than a slogan;
 * - says, in plain words, every kind of user data the app asks for and the
 *   purpose it is asked for — including exactly what Google sign-in and the
 *   `drive.file` connect scope do and do not reach.
 *
 * All of it is readable signed out. Signed-in visitors are taken straight to
 * their home screen instead, so this page never stands between someone and
 * their work.
 */
import { Link, Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  ClipboardCheck,
  FileDown,
  FileUp,
  Languages,
  Mic,
  PenLine,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import NavLocaleSwitcher from '../i18n/NavLocaleSwitcher'
import { getBadgeUrl } from '../components/layout/badge'

/**
 * The feature cards, in reading order: a key stem under `landing`, and the
 * icon that sits beside it. The icons are decorative — every card says what
 * it is in words — so they are hidden from assistive technology.
 */
const FEATURES = [
  { name: 'Live', Icon: Mic },
  { name: 'Seed', Icon: FileUp },
  { name: 'Board', Icon: PenLine },
  { name: 'Quiz', Icon: ClipboardCheck },
  { name: 'Speak', Icon: Languages },
  { name: 'After', Icon: FileDown },
] as const

/** The data disclosures, as key stems under `landing.data`. */
const DATA = ['Account', 'Google', 'Drive', 'Speech'] as const

export default function LandingPage() {
  const { status } = useAuth()
  const { t } = useTranslation()

  if (status === 'restoring') {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400">
        {t('common.loading')}
      </div>
    )
  }
  if (status === 'authenticated') {
    return <Navigate to="/app" replace />
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      <NavLocaleSwitcher />

      {/* Hero: who this is and what it is for, above the fold — drawn as a
          slide, since a slide is what the app makes. The frame borrows
          SlideView's idiom (a 16:9 white surface, rounded, with a dropped
          shadow) and sits on a tinted band, without which a white slide on
          a white page has no edge to read. Inside it is the oldest slide
          arrangement there is: a picture holding one side, the words the
          other.

          The ratio is a MINIMUM height, not a fixed one: `56.25cqw` is 16:9
          of the band's own width (hence the `@container`), so a wide page
          gets a slide-shaped box, and a phone — where the columns stack and
          this much text is taller than a box that narrow — gets a taller
          box instead of clipped words. */}
      <section className="@container rounded-2xl bg-slate-100 p-3 sm:p-5">
        <div className="grid min-h-[56.25cqw] items-center gap-8 rounded-xl border border-slate-200 bg-white px-6 py-10 shadow-2xl sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] sm:gap-10 sm:px-12">
          <div className="flex justify-center">
            {/* The picture is the slide's whole left column: it fills the
                column's width, and only stops growing if the slide is too
                short to hold it. */}
            <img
              src={getBadgeUrl()}
              alt=""
              aria-hidden
              className="h-36 w-auto sm:h-auto sm:max-h-80 sm:w-full"
            />
          </div>
          <div className="flex flex-col items-center gap-5 text-center sm:items-start sm:text-left">
            <h1 className="text-4xl font-bold tracking-tight">
              {t('landing.title')}
            </h1>
            <p className="text-lg text-slate-600">{t('landing.tagline')}</p>
            <p className="leading-7 text-slate-700">{t('landing.intro')}</p>
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-3 font-medium text-white"
            >
              <Mic className="h-5 w-5" aria-hidden />
              {t('landing.cta')}
            </Link>
          </div>
        </div>
      </section>

      {/* What it does — the functionality description Google asks for, and
          the thing a visitor wants to know first anyway. */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('landing.featuresTitle')}
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {FEATURES.map(({ name, Icon }) => (
            <div
              key={name}
              className="flex gap-4 rounded-lg border border-slate-200 p-5 text-left"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h3 className="font-semibold text-slate-900">
                  {t(`landing.feature${name}Title`)}
                </h3>
                <p className="mt-2 leading-7 text-slate-700">
                  {t(`landing.feature${name}Body`)}
                </p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6">
          <Link
            to="/about"
            className="text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
          >
            {t('landing.ctaAbout')}
          </Link>
        </p>
      </section>

      {/* Why we ask for what we ask for. Kept on the homepage rather than
          only in the policy: a visitor deciding whether to press "Continue
          with Google" should not have to open another page to learn what
          pressing it hands over. */}
      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t('landing.dataTitle')}
        </h2>
        <p className="mt-3 max-w-3xl leading-7 text-slate-700">
          {t('landing.dataIntro')}
        </p>
        <dl className="mt-6 max-w-3xl space-y-5 text-left">
          {DATA.map(name => (
            <div key={name}>
              <dt className="font-semibold text-slate-900">
                {t(`landing.data${name}Title`)}
              </dt>
              <dd className="mt-1 leading-7 text-slate-700">
                {t(`landing.data${name}Body`)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-3xl leading-7 font-medium text-slate-900">
          {t('landing.dataNever')}
        </p>
        <p className="mt-2 max-w-3xl leading-7 text-slate-700">
          {t('landing.dataMore')}{' '}
          <Link
            to="/privacy"
            className="text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
          >
            {t('landing.privacyLink')}
          </Link>
        </p>
      </section>
    </div>
  )
}
