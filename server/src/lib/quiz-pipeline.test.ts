/**
 * End-to-end test of the QUIZ-1 deliverable: lecture slide text runs through
 * the quiz provider and the YAML serializer to produce a Quiz-Generator-
 * compatible YAML file. Asserts the output parses and satisfies the
 * library's schema rules (github.com/bloombar/google-forms-quiz-generator,
 * YAML_FORMAT.md), using the mock provider so no AI credentials are needed.
 */
import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
import type { SlideTextContent } from '@slide-machine/shared'
import { MockQuizProvider } from '../providers/mock-quiz'
import { toQuizYaml } from './quiz-yaml'

const LECTURE: SlideTextContent[] = [
  {
    title: 'Photosynthesis',
    bullets: ['Occurs in chloroplasts', 'Needs sunlight'],
  },
  { title: 'Inputs', body: 'Carbon dioxide and water are consumed' },
  { title: 'Outputs', bullets: ['Glucose is produced', 'Oxygen is released'] },
]

const ALLOWED_TYPES = new Set([
  'single_choice',
  'multiple_choice',
  'dropdown',
  'short_text',
  'long_text',
])

describe('lecture material -> quiz-generator-compatible YAML', () => {
  it('produces a valid, parseable, schema-conformant quiz file', async () => {
    const quiz = await new MockQuizProvider().generateQuiz({ slides: LECTURE })
    const yaml = toQuizYaml(quiz, { emailCollection: 'verified' })

    // It is real YAML and round-trips
    const parsed = YAML.parse(yaml) as Record<string, unknown>

    // Top-level shape required by the Quiz Generator
    expect(parsed.version).toBe(1)
    expect(typeof parsed.title).toBe('string')
    expect(parsed.isQuiz).toBe(true)
    expect(parsed.emailCollection).toBe('verified')

    const questions = parsed.questions as Array<Record<string, unknown>>
    expect(questions.length).toBe(3)

    for (const q of questions) {
      expect(typeof q.title).toBe('string')
      expect(ALLOWED_TYPES.has(q.type as string)).toBe(true)
      expect(typeof q.points).toBe('number')

      const options = q.options as Array<{ value: string; isCorrect?: boolean }>
      expect(options.length).toBeGreaterThanOrEqual(2)
      // Choice questions mark exactly one correct answer
      expect(options.filter(o => o.isCorrect).length).toBe(1)
      for (const o of options) expect(typeof o.value).toBe('string')
    }
  })
})
