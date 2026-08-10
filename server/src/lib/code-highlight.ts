/**
 * A program listing, coloured for export (EXP-7).
 *
 * "Syntax highlighting carried where the format supports colored text" means
 * the exporters need the listing broken into coloured pieces. Both PDF and
 * pptx draw runs of text with a colour each, so that is what this produces:
 * spans, in order, each knowing what kind of token it is.
 *
 * The same tokenizer the slide uses, so a listing does not change colour on
 * its way out of the app. What differs is the palette: the browser applies a
 * stylesheet, and here the colours are chosen against the slide's own
 * background, since a theme may be light or dark and a fixed palette would be
 * unreadable on one of them.
 *
 * A language with no grammar is not an error — the listing comes back as one
 * uncoloured span, which is exactly as readable and merely less colourful.
 */
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import html from 'highlight.js/lib/languages/xml'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'

/** The same set the slide can highlight (client `code-languages.ts`).
 * Offering a language the export cannot colour would be a promise broken on
 * the way out. */
const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  html,
  java,
  javascript,
  json,
  python,
  r,
  ruby,
  rust,
  sql,
  typescript,
}

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language)
}

/** What an author is likely to have typed for a language we know by another
 * name. Mirrors the client's list; this is spelling, not detection. */
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

const resolveLanguage = (name: string | undefined): string | undefined => {
  if (!name) return undefined
  const key = name.trim().toLowerCase()
  const resolved = ALIASES[key] ?? key
  return LANGUAGES[resolved] ? resolved : undefined
}

/** One piece of a listing: some characters, and what they are. */
export interface CodeSpan {
  text: string
  /** The token kind, without highlight.js's `hljs-` prefix. Absent for
   * ordinary code — punctuation, identifiers, whitespace. */
  token?: string
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#x27': "'",
  '#39': "'",
}

const unescape = (text: string): string =>
  text.replace(/&(#x27|#39|amp|lt|gt|quot);/g, (whole, name: string) =>
    ENTITIES[name] !== undefined ? ENTITIES[name] : whole,
  )

/**
 * The listing, in order, as coloured pieces.
 *
 * highlight.js emits HTML, which is what the browser wants and not what an
 * exporter does, so it is walked back into spans here. A small scanner rather
 * than an HTML parser: the output is exactly nested `<span class="hljs-…">`
 * and escaped text, and nothing else — a parser would be a dependency to
 * handle a shape we already know.
 */
export const highlightCode = (
  source: string,
  language?: string,
): CodeSpan[] => {
  const resolved = resolveLanguage(language)
  if (!resolved || !source) return source ? [{ text: source }] : []

  let markup: string
  try {
    markup = hljs.highlight(source, { language: resolved }).value
  } catch {
    // A grammar that chokes on a fragment costs the listing its colours,
    // never the export.
    return [{ text: source }]
  }

  const spans: CodeSpan[] = []
  const open: string[] = []
  const push = (text: string) => {
    if (!text) return
    const token = open[open.length - 1]
    const last = spans[spans.length - 1]
    // Adjacent pieces of the same kind are one span: fewer runs for the
    // exporters to place, and identical output.
    if (last && last.token === token) last.text += text
    else spans.push(token ? { text, token } : { text })
  }

  // highlight.js writes a token's kind first and may add more classes after
  // it (`class="hljs-title function_"`), so the tail is matched and ignored.
  const TAG = /<span class="hljs-([\w-]+)[^"]*">|<\/span>/g
  let at = 0
  let match: RegExpExecArray | null
  while ((match = TAG.exec(markup))) {
    push(unescape(markup.slice(at, match.index)))
    if (match[1]) open.push(match[1])
    else open.pop()
    at = TAG.lastIndex
  }
  push(unescape(markup.slice(at)))
  return spans
}

/**
 * What each kind of token is drawn in, against a given background.
 *
 * Two palettes rather than one, chosen by the background's brightness: a
 * comment grey that reads on white disappears on navy. Colours are muted
 * enough to sit inside a slide's own palette rather than announcing
 * themselves as a code editor's.
 */
const LIGHT: Record<string, string> = {
  keyword: '#8250df',
  built_in: '#0550ae',
  type: '#0550ae',
  literal: '#0550ae',
  number: '#0550ae',
  string: '#0a7d33',
  comment: '#6e7781',
  title: '#953800',
  function: '#953800',
  attr: '#0550ae',
  variable: '#953800',
  params: '#24292f',
  meta: '#6e7781',
  operator: '#0550ae',
}

const DARK: Record<string, string> = {
  keyword: '#ff7b72',
  built_in: '#79c0ff',
  type: '#79c0ff',
  literal: '#79c0ff',
  number: '#79c0ff',
  string: '#a5d6ff',
  comment: '#8b949e',
  title: '#d2a8ff',
  function: '#d2a8ff',
  attr: '#79c0ff',
  variable: '#ffa657',
  params: '#c9d1d9',
  meta: '#8b949e',
  operator: '#79c0ff',
}

/** Perceived brightness of a `#rrggbb`, 0–1. Off a mid-grey a light theme
 * takes the light palette and a dark one the dark. */
const brightness = (hex: string): number => {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!value) return 1
  const n = parseInt(value[1]!, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** The colour a token is drawn in on this background, or nothing for
 * ordinary code, which takes the slide's own text colour. */
export const codeColor = (
  token: string | undefined,
  background: string,
): string | undefined => {
  if (!token) return undefined
  const palette = brightness(background) < 0.5 ? DARK : LIGHT
  // A token kind we have no colour for is ordinary code rather than a
  // guess: an unfamiliar name means the grammar knows something we do not.
  return palette[token]
}
