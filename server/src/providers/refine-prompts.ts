/**
 * Post-lecture refinement prompt loading (GEN-4). Like the slide-generation
 * and quiz templates, the wording lives OUTSIDE the code in config/prompts/ so
 * it can be tuned without a code change:
 *
 * - refine.txt   — "Refine all slides": improve one slide at a 1-5 strength.
 * - narrate.txt  — rewrite a slide's spoken narration at a 1-5 eloquence.
 * - reformat.txt — reframe a slide once speakers are known (student turns as
 *   questions/feedback).
 * - refit.txt    — fill the boxes a layout switch left empty (GEN-9).
 *
 * `{{slot}}` placeholders are filled per request; each file is read once and
 * cached (PROMPTS_DIR overrides the location).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { env } from '../config/env'

const cache = new Map<string, string>()

const read = (name: string): string => {
  let template = cache.get(name)
  if (template === undefined) {
    template = readFileSync(path.join(env.PROMPTS_DIR, name), 'utf8')
    cache.set(name, template)
  }
  return template
}

/** Fills `{{slot}}` placeholders; an unknown placeholder throws so a template
 * typo fails loudly on the first request, not silently. */
const fill = (name: string, slots: Record<string, string>): string =>
  read(name)
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (!(key in slots)) {
        throw new Error(`${name} uses unknown placeholder {{${key}}}`)
      }
      return slots[key]!
    })
    .trim()

export const renderRefinePrompt = (slots: Record<string, string>): string =>
  fill('refine.txt', slots)

export const renderNarratePrompt = (slots: Record<string, string>): string =>
  fill('narrate.txt', slots)

export const renderReformatPrompt = (slots: Record<string, string>): string =>
  fill('reformat.txt', slots)

export const renderRefitPrompt = (slots: Record<string, string>): string =>
  fill('refit.txt', slots)

/** Test hook: drop the cache so template edits are re-read. */
export const resetRefinePromptCache = (): void => cache.clear()
