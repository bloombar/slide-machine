/**
 * A clickable column header that sorts the table by its column. Only one
 * column sorts at a time: the active column shows a solid ↑/↓ arrow and
 * clicking it flips the direction; an inactive column shows a faint ↕ and
 * clicking it makes it the sole active sort (ascending first).
 */
export default function SortHeader<F extends string>({
  label,
  field,
  sort,
  onSort,
}: {
  label: string
  field: F
  // The page's full sort union; only clicks produce values, and those
  // are always `${field}:asc|desc`, which onSort accepts contravariantly.
  sort: `${string}:${'asc' | 'desc'}`
  onSort: (sort: `${F}:${'asc' | 'desc'}`) => void
}) {
  const [activeField, activeDir] = sort.split(':')
  const active = activeField === field
  return (
    <th
      scope="col"
      className="px-4 py-3"
      aria-sort={
        active ? (activeDir === 'asc' ? 'ascending' : 'descending') : 'none'
      }
    >
      <button
        type="button"
        onClick={() =>
          onSort(`${field}:${active && activeDir === 'asc' ? 'desc' : 'asc'}`)
        }
        className="group flex items-center gap-1 uppercase hover:text-slate-700"
      >
        {label}
        <span
          aria-hidden="true"
          className={
            active
              ? 'text-slate-700'
              : 'text-slate-400 group-hover:text-slate-600'
          }
        >
          {active ? (activeDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  )
}
