/**
 * Resolves a template's free-form theme object into the color set the
 * slide renderer and slot editors rely on, with safe fallbacks.
 */
export interface ThemeColors {
  background: string
  surface: string
  text: string
  muted: string
  accent: string
  /** Default whiteboard pen color for this template (WB-1): opaque, readable
   * on the background. Falls back to the text color. */
  penColor: string
  /** Default whiteboard highlighter color: rendered semi-transparent. Falls
   * back to the accent color. */
  highlighterColor: string
}

const color = (
  theme: Record<string, unknown>,
  key: string,
  fallback: string,
): string =>
  typeof theme[key] === 'string' ? (theme[key] as string) : fallback

export const themeColors = (theme: Record<string, unknown>): ThemeColors => {
  const text = color(theme, 'text', '#f1f5f9')
  const accent = color(theme, 'accent', '#38bdf8')
  return {
    background: color(theme, 'background', '#0f172a'),
    surface: color(theme, 'surface', '#1e293b'),
    text,
    muted: color(theme, 'muted', '#94a3b8'),
    accent,
    penColor: color(theme, 'penColor', text),
    highlighterColor: color(theme, 'highlighterColor', accent),
  }
}
