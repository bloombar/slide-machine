/**
 * Prompt templates live OUTSIDE the source code, in config/prompts/
 * (see docs/GENERATION_PROMPT.md), so wording can be tuned without a
 * code change:
 *
 * - generation.txt — the master instruction template; `{{slot}}`
 *   placeholders are filled per request.
 * - freedom-bands.txt — the 1-5 content-freedom policy texts, one per
 *   `[n]` section (an `[lo-hi]` range is also accepted).
 *
 * Files are read once and cached; PROMPTS_DIR overrides the location.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { env } from '../config/env'

const read = (name: string): string =>
  readFileSync(path.join(env.PROMPTS_DIR, name), 'utf8')

interface FreedomBand {
  lo: number
  hi: number
  text: string
}

let generationTemplate: string | undefined
let freedomBands: FreedomBand[] | undefined

const loadBands = (): FreedomBand[] => {
  if (freedomBands) return freedomBands
  const raw = read('freedom-bands.txt')
  const bands: FreedomBand[] = []
  let current: { lo: number; hi: number; lines: string[] } | null = null
  for (const line of raw.split('\n')) {
    // A section header is either a single level `[n]` or a range `[lo-hi]`.
    const header = /^\[(\d+)(?:-(\d+))?\]$/.exec(line.trim())
    if (header) {
      if (current)
        bands.push({
          lo: current.lo,
          hi: current.hi,
          text: current.lines.join('\n').trim(),
        })
      const lo = Number(header[1])
      current = { lo, hi: header[2] ? Number(header[2]) : lo, lines: [] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current)
    bands.push({
      lo: current.lo,
      hi: current.hi,
      text: current.lines.join('\n').trim(),
    })
  if (!bands.length)
    throw new Error('freedom-bands.txt contains no [n] sections')
  freedomBands = bands
  return bands
}

/** The content-freedom policy for a 1-5 setting: the number anchors a
 * gradient, the band text makes it operational for the model. */
export const freedomPolicy = (level: number): string => {
  const n = Math.min(5, Math.max(1, Math.round(level)))
  const band = loadBands().find(b => n >= b.lo && n <= b.hi) ?? loadBands()[0]!
  return `CONTENT FREEDOM ${n}/5 (1 = only what was said, 5 = free elaboration): ${band.text}`
}

/** Fills `{{slot}}` placeholders; unknown placeholders throw so a
 * template typo fails loudly at the first request, not silently. */
export const renderGenerationPrompt = (
  slots: Record<string, string>,
): string => {
  generationTemplate ??= read('generation.txt')
  return generationTemplate
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (!(key in slots)) {
        throw new Error(`generation.txt uses unknown placeholder {{${key}}}`)
      }
      return slots[key]!
    })
    .trim()
}

/** Test hook: drop the cache so template edits are re-read. */
export const resetPromptCache = (): void => {
  generationTemplate = undefined
  freedomBands = undefined
}
