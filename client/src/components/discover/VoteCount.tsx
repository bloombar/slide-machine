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
 */
import { useTranslation } from 'react-i18next'

export default function VoteCount({
  up,
  down,
  className = '',
}: {
  up: number
  down: number
  className?: string
}) {
  const { t } = useTranslation()
  const total = up + down
  return (
    <span
      className={`inline-flex w-20 shrink-0 items-center justify-end gap-1 text-xs text-slate-500 tabular-nums ${className}`}
      title={t('discover.votesBreakdown', { up, down })}
    >
      {t('discover.votes', { count: total })}
    </span>
  )
}
