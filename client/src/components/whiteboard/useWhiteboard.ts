/**
 * Whiteboard tool state (WB-1): which tool is active and each drawing tool's
 * color + thickness. Pen is always opaque, highlighter always semi-transparent
 * (opacity is fixed by tool, not stored here). Thickness is normalized to slide
 * width so a stroke keeps its visual weight across screen sizes.
 */
import { useState } from 'react'
import type { StrokeTool } from '@slide-machine/shared'

/** The active whiteboard tool, or null when drawing is off (normal editing). */
export type WhiteboardTool = StrokeTool | 'eraser' | null

/** A drawing tool's current color + thickness (thickness normalized to width). */
export interface ToolStyle {
  color: string
  thickness: number
}

/** Highlighter render opacity; pen is fully opaque. Shared by overlay + popover. */
export const HIGHLIGHTER_ALPHA = 0.4

/** Common swatches offered in the color popover, tuned per tool. */
export const PEN_COLORS = [
  '#1e293b',
  '#dc2626',
  '#2563eb',
  '#16a34a',
  '#ca8a04',
]
export const HIGHLIGHTER_COLORS = [
  '#fde047',
  '#86efac',
  '#93c5fd',
  '#f9a8d4',
  '#fdba74',
]

/** Thickness presets (normalized to slide width), thin → thick. */
export const PEN_THICKNESSES = [0.003, 0.006, 0.012]
export const HIGHLIGHTER_THICKNESSES = [0.02, 0.035, 0.05]

export interface Whiteboard {
  tool: WhiteboardTool
  penStyle: ToolStyle
  highlighterStyle: ToolStyle
  /** Selects a tool, or toggles it off when it's already active. */
  toggleTool: (tool: Exclude<WhiteboardTool, null>) => void
  setTool: (tool: WhiteboardTool) => void
  setPenStyle: (style: ToolStyle) => void
  setHighlighterStyle: (style: ToolStyle) => void
}

/** Optional template-derived default colors (WB-1): pre-select colors that
 * suit the deck's design template. */
export interface WhiteboardDefaults {
  penColor?: string
  highlighterColor?: string
}

export function useWhiteboard(defaults?: WhiteboardDefaults): Whiteboard {
  const [tool, setTool] = useState<WhiteboardTool>(null)
  const [penStyle, setPenStyle] = useState<ToolStyle>({
    color: defaults?.penColor ?? PEN_COLORS[0]!,
    thickness: PEN_THICKNESSES[1]!,
  })
  const [highlighterStyle, setHighlighterStyle] = useState<ToolStyle>({
    color: defaults?.highlighterColor ?? HIGHLIGHTER_COLORS[0]!,
    thickness: HIGHLIGHTER_THICKNESSES[1]!,
  })

  // Re-default a tool's color when the template's color changes (e.g. the deck
  // loads or switches template). Thickness and any later manual pick within a
  // template are preserved. This is React's supported "adjust state during
  // render" pattern: track the last-seen template color and re-sync only when
  // it actually moves, rather than in an effect.
  const penColor = defaults?.penColor
  const highlighterColor = defaults?.highlighterColor
  const [seenPenColor, setSeenPenColor] = useState(penColor)
  if (penColor !== seenPenColor) {
    setSeenPenColor(penColor)
    if (penColor) setPenStyle(s => ({ ...s, color: penColor }))
  }
  const [seenHighlighterColor, setSeenHighlighterColor] =
    useState(highlighterColor)
  if (highlighterColor !== seenHighlighterColor) {
    setSeenHighlighterColor(highlighterColor)
    if (highlighterColor)
      setHighlighterStyle(s => ({ ...s, color: highlighterColor }))
  }

  const toggleTool = (next: Exclude<WhiteboardTool, null>) =>
    setTool(current => (current === next ? null : next))

  return {
    tool,
    penStyle,
    highlighterStyle,
    toggleTool,
    setTool,
    setPenStyle,
    setHighlighterStyle,
  }
}
