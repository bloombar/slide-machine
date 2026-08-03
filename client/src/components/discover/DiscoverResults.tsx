/**
 * The body of a browsable list (SOC-2/SOC-3): lecture rows, plus the matching
 * projects and people when a search is running, and the lazy-load trigger at
 * the end. Every lecture row looks the same whether it came from the feed or
 * from a search, since both arrive in the same shape.
 *
 * Presentational — it takes the state `useDiscover` produces and renders it, so
 * the home sidebar and a future full Discover page can style around it.
 */
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { FeedDeck } from '@slide-machine/shared'
import { lectureTitle } from '../../lib/lecture'
import { untitledProject } from '../../lib/project'
import type { Discover } from './useDiscover'
import RatingBadge from './RatingBadge'
import LoadMore from './LoadMore'

/** One lecture: the title leads, its project and owner sit beneath as links,
 * and the net rating sits to the right. Exported so a page presenting the same
 * content differently can compose it, or pass `renderRow` to replace it. */
export function LectureRow({ deck }: { deck: FeedDeck }) {
  const { t } = useTranslation()
  return (
    <li className="border-b border-slate-200 px-3 py-2.5 last:border-0">
      <Link
        to={`/d/${deck.slug}`}
        className="block text-sm font-medium text-slate-900 hover:text-indigo-600"
      >
        {lectureTitle(deck)}
      </Link>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-slate-500">
          <Link
            to={`/app/projects/${deck.project.id}`}
            className="hover:text-indigo-600"
          >
            {deck.project.title.trim() || untitledProject()}
          </Link>
          <span aria-hidden> · </span>
          <Link to={`/u/${deck.owner.id}`} className="hover:text-indigo-600">
            {deck.owner.displayName || t('discover.unknownOwner')}
          </Link>
        </span>
        <RatingBadge score={deck.voteScore} />
      </div>
    </li>
  )
}

/** A titled result group (lectures, projects, people). */
function Group({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="border-b border-slate-200 last:border-0">
      <p className="px-3 pt-2 pb-1 text-[0.7rem] font-semibold tracking-wide text-slate-400 uppercase">
        {title}
      </p>
      <ul>{children}</ul>
    </li>
  )
}

/** A compact project or person match. */
function ResultRow({
  to,
  primary,
  secondary,
}: {
  to: string
  primary: string
  secondary?: string
}) {
  return (
    <li>
      <Link to={to} className="block px-3 py-1.5 hover:bg-white">
        <span className="block truncate text-sm font-medium text-slate-900">
          {primary}
        </span>
        {secondary && (
          <span className="block truncate text-xs text-slate-500">
            {secondary}
          </span>
        )}
      </Link>
    </li>
  )
}

export default function DiscoverResults({
  discover,
  className = '',
  renderRow = deck => <LectureRow key={deck.id} deck={deck} />,
}: {
  discover: Discover
  /** How one row is drawn. Defaults to a lecture row; a list of some other
   * kind of content supplies its own rather than forking this component. */
  renderRow?: (deck: FeedDeck) => React.ReactNode
  /** Chrome for the host layout. The sidebar scrolls the list inside a fixed
   * card ("min-h-0 flex-1 overflow-y-auto"); a full page lets the document
   * scroll instead. Kept out of the component so the same list serves both. */
  className?: string
}) {
  const { t } = useTranslation()
  const { page, error, searching, query, loadingMore, loadMore } = discover

  const message = (text: string) => (
    <p className="px-3 py-3 text-sm text-slate-500">{text}</p>
  )

  if (error)
    return message(
      searching ? t('discover.searchFailed') : t('discover.loadFailed'),
    )
  if (!page)
    return message(searching ? t('discover.searching') : t('common.loading'))

  const { lectures, projects, users, hasMore } = page
  if (lectures.length === 0 && projects.length === 0 && users.length === 0) {
    return message(
      searching
        ? t('discover.noMatches', { query: query.trim() })
        : t('discover.empty'),
    )
  }

  // In feed mode the lectures stand alone; a search groups them by kind so the
  // three sorts of match stay tellable apart.
  const lectureRows = lectures.map(renderRow)

  return (
    <ul className={className}>
      {searching ? (
        <>
          {lectures.length > 0 && (
            <Group title={t('discover.groupLectures')}>{lectureRows}</Group>
          )}
          {projects.length > 0 && (
            <Group title={t('discover.groupProjects')}>
              {projects.map(p => (
                <ResultRow
                  key={p.id}
                  to={`/app/projects/${p.id}`}
                  primary={p.title.trim() || untitledProject()}
                  secondary={p.owner.displayName || t('discover.unknownOwner')}
                />
              ))}
            </Group>
          )}
          {users.length > 0 && (
            <Group title={t('discover.groupPeople')}>
              {users.map(u => (
                <ResultRow
                  key={u.id}
                  to={`/u/${u.id}`}
                  primary={u.displayName}
                />
              ))}
            </Group>
          )}
        </>
      ) : (
        lectureRows
      )}
      {hasMore && (
        <li>
          <LoadMore onLoadMore={loadMore} loading={loadingMore} />
        </li>
      )}
    </ul>
  )
}
