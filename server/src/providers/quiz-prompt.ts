/**
 * Quiz-generation prompt loading (SPEC QUIZ-1). Like the slide-generation
 * template, the wording lives OUTSIDE the code in config/prompts/quiz.txt
 * so it can be tuned without a code change. `{{slot}}` placeholders are
 * filled per request; the file is read once and cached (PROMPTS_DIR
 * overrides the location).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  QuizQuestionCounts,
  QuizQuestionType,
  SlideTextContent,
} from '@slide-machine/shared'
import { env } from '../config/env'

/** Human labels for each type, used in the prompt's breakdown line. */
const TYPE_LABELS: Record<QuizQuestionType, string> = {
  single_choice: 'single_choice (one correct)',
  multiple_choice: 'multiple_choice (one or more correct)',
  short_text: 'short_text',
  long_text: 'long_text',
}

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

/** Cap on how much transcript text is sent, so a long lecture cannot blow
 * past the model's context or run up the token bill. */
const MAX_TRANSCRIPT_CHARS = 12000

/** Cap on how many prior questions are listed in the "avoid" block. */
const MAX_AVOID_QUESTIONS = 40

/**
 * The optional spoken-transcript section of the prompt. Empty string when no
 * transcript is supplied, so the `{{transcript}}` slot simply vanishes. A long
 * transcript is truncated to keep the prompt (and cost) bounded.
 */
export const renderTranscriptBlock = (transcript?: string): string => {
  const text = transcript?.trim()
  if (!text) return ''
  const clipped =
    text.length > MAX_TRANSCRIPT_CHARS
      ? `${text.slice(0, MAX_TRANSCRIPT_CHARS)}…`
      : text
  return `\nSpoken transcript (what the lecturer said aloud; it may contain detail not on the slides — you may quiz this too):\n${clipped}\n`
}

/**
 * The optional "do not repeat" section listing previously asked questions.
 * Empty string when there are none. Used so a regenerated quiz differs from
 * the ones the instructor already discarded (QUIZ-6).
 */
export const renderAvoidBlock = (questions?: string[]): string => {
  const list = (questions ?? []).map(q => q.trim()).filter(Boolean)
  if (list.length === 0) return ''
  const bullets = list
    .slice(0, MAX_AVOID_QUESTIONS)
    .map(q => `- ${q}`)
    .join('\n')
  return `\nDo NOT repeat or closely paraphrase any of these previously asked questions; write different ones:\n${bullets}\n`
}

/**
 * The `{{types}}` line: how many questions of each type to write. With per-type
 * counts (QUIZ-7) it lists each; otherwise it asks for `count` single_choice
 * questions.
 */
export const renderTypesBlock = (
  count: number,
  typeCounts?: QuizQuestionCounts,
): string => {
  const entries = Object.entries(typeCounts ?? {}).filter(
    ([, n]) => (n ?? 0) > 0,
  ) as [QuizQuestionType, number][]
  if (entries.length === 0) {
    return `Write EXACTLY ${count} single_choice questions.`
  }
  const parts = entries.map(([type, n]) => `${n} ${TYPE_LABELS[type]}`)
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  return `Write EXACTLY these ${total} questions, matching each type and count precisely: ${parts.join(', ')}.`
}

/** The optional `{{points}}` line asking the model to spread a points budget. */
export const renderPointsBlock = (totalPoints?: number): string => {
  if (!totalPoints || totalPoints <= 0) return ''
  return `\nSet each question's "points" so they total ${Math.round(totalPoints)} across the quiz — whole numbers, each at least 1.\n`
}

/** The optional `{{instructions}}` block carrying the instructor's own steer. */
export const renderInstructionsBlock = (instructions?: string): string => {
  const text = instructions?.trim()
  if (!text) return ''
  return `\nExtra instructions from the instructor (follow these, but stay within the lecture material):\n${text}\n`
}

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
