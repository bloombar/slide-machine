/**
 * Sticky full-width footer with the two at-a-glance status readouts: the API's
 * health, shown to everyone, and the signed-in account's plan usage (BILL-4),
 * which renders nothing for a signed-out visitor. Both expand on click.
 *
 * They sit as a centred pair rather than one centred item, so neither reads as
 * the primary and the other an afterthought.
 */
import HealthBadge from '../HealthBadge'
import UsageBadge from '../UsageBadge'

export default function HealthFooter() {
  return (
    <footer className="sticky bottom-0 z-30 flex h-8 items-center justify-center gap-4 border-t border-slate-200 bg-white/95 px-4 backdrop-blur">
      <HealthBadge />
      <UsageBadge />
    </footer>
  )
}
