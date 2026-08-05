/**
 * The arrangement engine (TMPL-4).
 *
 * Every other renderer in this directory is a hand-written arrangement: code
 * that decides the title sits across the top and the image fills the right.
 * Users cannot write code, so a template they author carries its arrangement
 * as *data* — a box per slot — and this component turns that data into DOM.
 * One renderer, any arrangement.
 *
 * It runs for templates that declare `renderMode: 'positioned'`; the built-ins
 * declare nothing and keep their hand-tuned components, so the two coexist
 * (docs/TEMPLATES.md §4).
 *
 * Boxes are normalized 0–1, so an arrangement holds at any size — a thumbnail
 * in the library and the full-bleed viewer are the same layout scaled.
 */
import type { LayoutSlot, SlotBox } from '@slide-machine/shared'
import type { ThemeColors } from '../theme'
import type { LayoutProps } from './types'

/** A box's colour is either a theme key, so a template's palette stays the
 * single source of truth, or a literal the author chose. */
const resolveColor = (
  color: string | undefined,
  colors: ThemeColors,
): string | undefined => {
  if (!color) return undefined
  return color in colors ? colors[color as keyof ThemeColors] : color
}

/** Flex alignment for a box's own content. */
const FLEX: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
}

const boxStyle = (box: SlotBox, colors: ThemeColors): React.CSSProperties => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.w * 100}%`,
  height: `${box.h * 100}%`,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: FLEX[box.vAlign ?? 'start'],
  alignItems: FLEX[box.align ?? 'start'],
  // cqi so type scales with the slide, exactly as the hand-tuned components do
  fontSize: box.fontSize ? `${box.fontSize}cqi` : undefined,
  fontWeight: box.fontWeight,
  color: resolveColor(box.color, colors),
  textAlign: box.align === 'center' ? 'center' : undefined,
})

export default function PositionedLayout({
  layout,
  colors,
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
            style={boxStyle(box, colors)}
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
