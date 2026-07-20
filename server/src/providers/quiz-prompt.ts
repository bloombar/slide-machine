/**
 * Quiz-generation prompt loading (SPEC QUIZ-1). Like the slide-generation
 * template, the wording lives OUTSIDE the code in config/prompts/quiz.txt
 * so it can be tuned without a code change. `{{slot}}` placeholders are
 * filled per request; the file is read once and cached (PROMPTS_DIR
 * overrides the location).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SlideTextContent } from '@slide-machine/shared'
import { env } from '../config/env'

let quizTemplate: string | undefined

const read = (name: string): string =>
  readFileSync(path.join(env.PROMPTS_DIR, name), 'utf8')

/**
 * Renders de-identified slide text into the numbered block the prompt
 * shows the model. Empty slides (no title/body/bullets) are skipped so
 * they cannot pad the source material with blanks.
 */
export const renderSlidesBlock = (slides: SlideTextContent[]): string =>
  slides
    .map(s => {
      const parts: string[] = []
      if (s.title?.trim()) parts.push(s.title.trim())
      if (s.body?.trim()) parts.push(s.body.trim())
      for (const b of s.bullets ?? []) if (b.trim()) parts.push(`- ${b.trim()}`)
      return parts.join('\n')
    })
    .filter(block => block.length > 0)
    .map((block, i) => `Slide ${i + 1}:\n${block}`)
    .join('\n\n')

/** Fills `{{slot}}` placeholders; an unknown placeholder throws so a
 * template typo fails loudly on the first request, not silently. */
export const renderQuizPrompt = (slots: Record<string, string>): string => {
  quizTemplate ??= read('quiz.txt')
  return quizTemplate
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (!(key in slots)) {
        throw new Error(`quiz.txt uses unknown placeholder {{${key}}}`)
      }
      return slots[key]!
    })
    .trim()
}

/** Test hook: drop the cache so template edits are re-read. */
export const resetQuizPromptCache = (): void => {
  quizTemplate = undefined
}
