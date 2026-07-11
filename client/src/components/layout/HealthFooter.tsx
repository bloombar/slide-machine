/**
 * Sticky full-width footer with the compact API status — shown on every
 * page for every user.
 */
import HealthBadge from '../HealthBadge'

export default function HealthFooter() {
  return (
    <footer className="sticky bottom-0 z-30 flex h-8 items-center overflow-hidden border-t border-slate-200 bg-white/95 backdrop-blur">
      <HealthBadge />
    </footer>
  )
}
