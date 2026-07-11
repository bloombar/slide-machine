/**
 * Sticky full-width footer with the compact API status — shown on every
 * page for every user.
 */
import HealthBadge from '../HealthBadge'

export default function HealthFooter() {
  return (
    <footer className="sticky bottom-0 z-30 border-t border-slate-200 bg-white/95 py-1.5 backdrop-blur">
      <HealthBadge />
    </footer>
  )
}
