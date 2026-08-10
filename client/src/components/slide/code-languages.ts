/**
 * The languages a code slot can be highlighted as.
 *
 * Names only — no grammars, no highlighter. The template editor needs to
 * offer this list, and the slide needs to resolve what an author typed, and
 * neither should drag a highlighting engine into the bundle to do it. The
 * grammars load with the component that uses them (`CodeHighlighted.tsx`).
 */

/** The languages a lecture is plausibly given in. Offering one here is a
 * promise the slide keeps, so this list and the registered grammars are the
 * same list. */
export const HIGHLIGHTED_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'python',
  'r',
  'ruby',
  'rust',
  'sql',
  'typescript',
] as const

const KNOWN = new Set<string>(HIGHLIGHTED_LANGUAGES)

/** What an author is likely to have typed for a language we know by another
 * name. Kept short: this is spelling, not detection. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  sh: 'bash',
  shell: 'bash',
  htm: 'html',
  xml: 'html',
}

/** The language an author's name refers to, or nothing — in which case the
 * listing is shown plainly, which is exactly as readable. */
export const resolveLanguage = (
  name: string | undefined,
): string | undefined => {
  if (!name) return undefined
  const key = name.trim().toLowerCase()
  const resolved = ALIASES[key] ?? key
  return KNOWN.has(resolved) ? resolved : undefined
}
