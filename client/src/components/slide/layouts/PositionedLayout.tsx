/**
 * The absolute-geometry renderer (TMPL-4).
 *
 * Draws a layout from `elementPositions` — a box per slot, in normalized 0–1
 * coordinates. This is the path a design imported from Google Slides takes:
 * it arrives as absolute geometry with no flow to fall back on (TMPL-8), and
 * there is nothing to infer a tree from.
 *
 * A layout that carries a tree is drawn by FlowLayout instead; this runs when
 * geometry is all there is.
 *
 * Boxes are fractions, so an arrangement holds at any size — a thumbnail in
 * the library and the full-bleed viewer are the same layout scaled.
 */
import type { LayoutSlot } from '@slide-machine/shared'
import { tierOf } from '@slide-machine/shared'
import type { LayoutProps } from './types'
import { resolveStyle, contentStyle, resolveColor } from './boxStyle'

export default function PositionedLayout({
  layout,
  colors,
  textStyles,
  editable,
  slot,
}: LayoutProps) {
  const positions = layout?.elementPositions ?? {}
  // Declaration order decides paint order, so a template can put a caption
  // over an image by declaring it later.
  const placed = (layout?.slots ?? []).filter(s => positions[s.name])

  return (
    <div className="relative h-full w-full">
      {/*
        Bands, rules, logos and background pictures, painted first so every
        slot sits on top of them. They hold no content, so they are not
        focusable and carry no alt text — a decorative logo announced on every
        slide is noise to a screen reader, not information.
      */}
      {(layout?.decoration ?? []).map((piece, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="pointer-events-none absolute bg-cover bg-center bg-no-repeat"
          style={{
            left: `${piece.x * 100}%`,
            top: `${piece.y * 100}%`,
            width: `${piece.w * 100}%`,
            height: `${piece.h * 100}%`,
            ...(piece.fill
              ? { background: resolveColor(piece.fill, colors) }
              : {}),
            ...(piece.imageUrl
              ? { backgroundImage: `url(${JSON.stringify(piece.imageUrl)})` }
              : {}),
            ...(piece.radius ? { borderRadius: `${piece.radius}cqi` } : {}),
          }}
        />
      ))}
      {placed.map(spec => {
        const box = positions[spec.name]!
        const style = resolveStyle(box, textStyles)
        return (
          <div
            key={spec.name}
            // What this box holds, for the layout transition (lib/layoutFlip).
            data-flip-tier={tierOf(spec.kind, box.textStyle)}
            className="absolute overflow-hidden"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              ...contentStyle(style, colors),
            }}
          >
            {slot(spec.name as LayoutSlot)}
          </div>
        )
      })}
      {/* An empty arrangement in the editor would be an invisible slide with
          nothing to click, so say so rather than render nothing. */}
      {placed.length === 0 && editable && (
        <div className="flex h-full w-full items-center justify-center" />
      )}
    </div>
  )
}
