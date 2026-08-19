/**
 * Rows and columns, with an optional header (TMPL-9 `table` / EDIT-7).
 *
 * A real `<table>` rather than a grid of divs, because a table is what it is:
 * a screen reader announces the header a cell belongs to, and a row read out
 * of order is still a row. Styling inherits the slide's typography, so a table
 * on a dark template is a dark table.
 *
 * Every cell is ruled, not just the rows. Columns without lines between them
 * read as loose text at a distance — which is the distance a lecture hall is
 * — and the same grid is what the exporters draw, so a table looks like the
 * one the audience saw wherever it ends up (EXP-7).
 *
 * ## Track sizes
 *
 * A table that carries column widths or row heights (EDIT-7) is drawn to them,
 * as percentages of its own box, which is how the exporters read the same
 * fractions. One that carries none keeps the old behaviour exactly — equal
 * columns, rows as tall as their content — so a table nobody has resized looks
 * the same as it always did.
 */
import { tableTracks, tableColumnCount } from '@slide-machine/shared'

interface Props {
  header?: string[]
  rows: string[][]
  colWidths?: number[]
  rowHeights?: number[]
}

export default function SlideTable({
  header,
  rows,
  colWidths,
  rowHeights,
}: Props) {
  const width = tableColumnCount(rows, header)
  const cells = (row: string[]) =>
    Array.from({ length: width }, (_, i) => row[i] ?? '')

  const columns = colWidths?.length ? tableTracks(colWidths, width) : undefined
  // The header counts as a row when it is there, so dragging the boundary
  // below it means what it looks like it means.
  const bands = header?.length ? rows.length + 1 : rows.length
  const heights = rowHeights?.length
    ? tableTracks(rowHeights, bands)
    : undefined
  const rowStyle = (band: number) =>
    heights ? { height: `${heights[band]! * 100}%` } : undefined

  return (
    <table
      className={`w-full table-fixed border-collapse text-start text-[2cqi] ${
        // Percentage row heights need something to be a percentage of, so a
        // table with heights fills its box. Without them the table is as tall
        // as its rows, which is what an unsized table has always been.
        heights ? 'h-full' : ''
      }`}
    >
      {columns ? (
        <colgroup>
          {columns.map((w, i) => (
            <col key={i} style={{ width: `${w * 100}%` }} />
          ))}
        </colgroup>
      ) : null}
      {header?.length ? (
        <thead>
          <tr style={rowStyle(0)}>
            {cells(header).map((cell, i) => (
              <th
                key={i}
                scope="col"
                className="border border-current/30 px-[1cqi] py-[0.6cqi] text-start font-semibold"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((row, r) => (
          <tr key={r} style={rowStyle(header?.length ? r + 1 : r)}>
            {cells(row).map((cell, c) => (
              <td
                key={c}
                className="border border-current/25 px-[1cqi] py-[0.6cqi] align-top"
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
