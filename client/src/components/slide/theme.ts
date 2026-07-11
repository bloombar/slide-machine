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
}

const color = (
  theme: Record<string, unknown>,
  key: string,
  fallback: string,
): string =>
  typeof theme[key] === 'string' ? (theme[key] as string) : fallback

export const themeColors = (theme: Record<string, unknown>): ThemeColors => ({
  background: color(theme, 'background', '#0f172a'),
  surface: color(theme, 'surface', '#1e293b'),
  text: color(theme, 'text', '#f1f5f9'),
  muted: color(theme, 'muted', '#94a3b8'),
  accent: color(theme, 'accent', '#38bdf8'),
})
