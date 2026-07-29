/**
 * Resolves a template's free-form theme into the color set the deck exports
 * need (background, text, accent, muted), so the PDF and Google Slides output
 * carry the same colors the app's viewer shows. Mirrors the client resolver
 * (components/slide/theme.ts): read the named keys, fall back to a neutral
 * light theme when a template omits them.
 */
export interface ExportTheme {
  background: string
  text: string
  accent: string
  muted: string
}

/** A neutral light theme for when a template can't be resolved. */
export const DEFAULT_THEME: ExportTheme = {
  background: '#ffffff',
  text: '#1c2230',
  accent: '#4a54d1',
  muted: '#6b7280',
}

const pick = (
  theme: Record<string, unknown>,
  key: keyof ExportTheme,
): string =>
  typeof theme[key] === 'string' ? (theme[key] as string) : DEFAULT_THEME[key]

/** The export color set for a template's theme object (or the default). */
export const resolveTemplateTheme = (
  theme?: Record<string, unknown>,
): ExportTheme => {
  const t = theme ?? {}
  return {
    background: pick(t, 'background'),
    text: pick(t, 'text'),
    accent: pick(t, 'accent'),
    muted: pick(t, 'muted'),
  }
}
