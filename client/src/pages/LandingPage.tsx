/**
 * Public landing page: product tagline and API health. Auth entry links
 * live in the PublicShell header.
 */
import HealthBadge from '../components/HealthBadge'

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Slide Machine V2</h1>
      <p className="text-slate-600">Speak freely — the slides will follow.</p>
      <HealthBadge />
    </div>
  )
}
