/**
 * A lecture's rating at a glance (SOC-1): one icon and one number — the net
 * score, so 4 up-votes and 2 down-votes read as "2".
 *
 * Deliberately not a button, and deliberately not an arrow. Voting happens
 * inside the lecture, so this carries no border, no chip, and no hover state:
 * an arrow inside a bordered pill reads as something you can press, and a list
 * should never look like it offers a control it will not honour. A filled star
 * beside a number reads as a score being reported. Used by every browsable list
 * (the home feed today, the Discover page later) so the rating looks the same
 * wherever it appears.
 */
import { useTranslation } from 'react-i18next'
import { Star } from 'lucide-react'

export default function RatingBadge({
  score,
  className = '',
}: {
  /** Net score: up-votes minus down-votes. May be negative. */
  score: number
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-slate-400 ${className}`}
      aria-label={t('discover.rating', { score })}
      title={t('discover.ratingTitle', { score })}
    >
      <Star className="h-3.5 w-3.5 fill-current" aria-hidden />
      <span className="text-xs font-semibold tabular-nums">{score}</span>
    </span>
  )
}
