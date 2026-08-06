/**
 * A clickable column header that sorts the table by its column. Only one
 * column sorts at a time, and only that column is marked: it shows a solid
 * ↑/↓ arrow for the direction, and clicking it flips the direction. Every
 * other column shows its label alone; clicking one makes it the sole
 * sorting column (ascending first).
 *
 * The arrow points the way the column's values run down the rows: an
 * ordinary column sorted ascending reads A→Z, 0→9 downwards, so it points
 * down. A date column reads the other way round — ascending puts the
 * oldest at the top, with time running up out of the past — so it points
 * up. See the `chronological` prop.
 */
export default function SortHeader<F extends string>({
  label,
  field,
  sort,
  onSort,
  align = 'left',
  chronological = false,
  className = 'px-4 py-3',
}: {
  label: string
  field: F
  /** The table's current sort, or null when no column is sorting it —
   * the rows are in whatever order they arrived in. */
  // The page's full sort union; only clicks produce values, and those
  // are always `${field}:asc|desc`, which onSort accepts contravariantly.
  sort: `${string}:${'asc' | 'desc'}` | null
  onSort: (sort: `${F}:${'asc' | 'desc'}`) => void
  /** Match the column's cells; numeric columns are right-aligned. */
  align?: 'left' | 'right'
  /** Set on a column of dates or times, which flips the arrow: ascending
   * (oldest first) points up, descending (newest first) points down. */
  chronological?: boolean
  /** The cell's own spacing, to match the table it heads. Defaults to the
   * directory tables'; the compact tables nested in a detail page pass
   * their own. */
  className?: string
}) {
  const [activeField, activeDir] = sort?.split(':') ?? []
  const active = activeField === field
  const ascending = activeDir === 'asc'
  const right = align === 'right'
  const arrow = ascending === chronological ? '↑' : '↓'
  return (
    <th
      scope="col"
      className={`${className} ${right ? 'text-right' : ''}`}
      aria-sort={active ? (ascending ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() =>
          onSort(`${field}:${active && ascending ? 'desc' : 'asc'}`)
        }
        // Right-aligned headers stretch so the label sits over its column
        className={`flex items-center gap-1 uppercase hover:text-slate-700 ${
          right ? 'w-full justify-end' : ''
        }`}
      >
        {label}
        {active && (
          <span aria-hidden="true" className="text-slate-700">
            {arrow}
          </span>
        )}
      </button>
    </th>
  )
}
