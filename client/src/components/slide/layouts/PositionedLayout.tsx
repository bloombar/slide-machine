/**
 * The arrangement engine (TMPL-4).
 *
 * Every other renderer in this directory is a hand-written arrangement: code
 * that decides the title sits across the top and the image fills the right.
 * Users cannot write code, so a template they author carries its arrangement
 * as *data* — a box per slot — and this component turns that data into DOM.
 * One renderer, any arrangement.
 *
 * It runs only for layouts that actually carry positions; the built-ins have
 * none and keep their hand-tuned components, so the two coexist and a layout
 * can move to data on its own (docs/TEMPLATES.md).
 *
 * Boxes are percentages, so an arrangement holds at any size — a thumbnail in
 * the library and the full-bleed viewer are the same layout scaled.
 */
import type { LayoutSlot } from '@slide-machine/shared'
import type { LayoutProps } from './types'

export default function PositionedLayout({
  layout,
  editable,
  slot,
}: LayoutProps) {
  const positions = layout?.elementPositions ?? {}
  // Declaration order decides paint order, so a template can put a caption
  // over an image by declaring it later.
  const placed = (layout?.slots ?? []).filter(s => positions[s.name])

  return (
    <div className="relative h-full w-full">
      {placed.map(spec => {
        const box = positions[spec.name]!
        return (
          <div
            key={spec.name}
            className="absolute overflow-hidden"
            style={{
              left: `${box.x}%`,
              top: `${box.y}%`,
              width: `${box.w}%`,
              height: `${box.h}%`,
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
