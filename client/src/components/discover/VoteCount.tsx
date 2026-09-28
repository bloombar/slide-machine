/**
 * How many people voted on a lecture (SOC-1), the way a link aggregator shows
 * it: a plain total. Four in favour and five against is nine votes — the
 * figure says how much attention a lecture drew, not which way it went.
 * Ranking still uses the net score; this is only what a browsable list shows.
 *
 * Sits in its own right-hand column so the counts line up down the list and
 * read as a separate field, not as a trailing fragment of the author's name.
 * Set in the same size and weight as the project and author beside it: it is
 * one more fact about the lecture, not a louder one.
 * The words carry it: voting happens inside the lecture, and an arrow or a
 * chip beside the number would suggest a control this list will not honour.
 *
 * `size="compact"` drops the fixed column width for the tight space a
 * template library card's icon row gives it (TMPL-27) — the owner of a
 * template sees this in place of the vote buttons everyone else gets there.
 */
import { useTranslation } from 'react-i18next'

export default function VoteCount({
  up,
  down,
  size = 'default',
  className = '',
}: {
  up: number
  down: number
  size?: 'default' | 'compact'
  className?: string
}) {
  const { t } = useTranslation()
  const total = up + down
  const compact = size === 'compact'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 tabular-nums ${
        compact
          ? 'text-[0.65rem] text-slate-500'
          : 'w-20 justify-end text-xs text-slate-500'
      } ${className}`}
      title={t('discover.votesBreakdown', { up, down })}
    >
      {t('discover.votes', { count: total })}
    </span>
  )
}
