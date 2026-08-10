/**
 * Rows and columns, with an optional header (TMPL-9 `table` / EDIT-7).
 *
 * A real `<table>` rather than a grid of divs, because a table is what it is:
 * a screen reader announces the header a cell belongs to, and a row read out
 * of order is still a row. Styling inherits the slide's typography, so a table
 * on a dark template is a dark table.
 */
interface Props {
  header?: string[]
  rows: string[][]
}

export default function SlideTable({ header, rows }: Props) {
  const width = Math.max(header?.length ?? 0, ...rows.map(r => r.length), 1)
  const cells = (row: string[]) =>
    Array.from({ length: width }, (_, i) => row[i] ?? '')

  return (
    <table className="w-full table-fixed border-collapse text-start text-[2cqi]">
      {header?.length ? (
        <thead>
          <tr>
            {cells(header).map((cell, i) => (
              <th
                key={i}
                scope="col"
                className="border-b border-current/30 px-[1cqi] py-[0.6cqi] text-start font-semibold"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {cells(row).map((cell, c) => (
              <td
                key={c}
                className="border-b border-current/10 px-[1cqi] py-[0.6cqi] align-top"
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
