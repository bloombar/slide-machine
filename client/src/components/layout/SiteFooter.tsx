/**
 * Site footer: a plain row of links to the static pages, above the status
 * strip. It exists so the privacy policy is reachable in one click from any
 * page without opening the hamburger drawer first — a condition of Google's
 * OAuth homepage requirements (docs/GOOGLE_PRODUCTION_MODE.md §3.3), and
 * better for anyone else looking for it too.
 *
 * The links and their English labels come from staticLinks.ts, shared with
 * the drawer so both ways in name the same pages. The landmark's own label is
 * translated — it is chrome, unlike the document names it introduces.
 */
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { getFeedbackEnabled } from '../../runtime-config'
import { STATIC_GROUPS } from './staticLinks'

export default function SiteFooter() {
  const { t } = useTranslation()
  const mail = getFeedbackEnabled()
  const links = STATIC_GROUPS.flat().filter(link => !link.needsMail || mail)
  return (
    <nav
      aria-label={t('nav.legal')}
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-3 text-xs text-slate-500"
    >
      {links.map(link => (
        <Link
          key={link.to}
          to={link.to}
          className="hover:text-slate-900 hover:underline"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
