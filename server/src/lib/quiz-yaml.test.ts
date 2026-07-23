/**
 * Unit tests for the Quiz-Generator YAML serializer: the object mapping to
 * the library's single_choice schema, defaults (version, isQuiz, email
 * collection, points), optional description, round-trip parse-ability, and
 * the loud failures on a quiz that could not produce a valid form.
 */
import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
import type { QuizDefinition } from '@slide-machine/shared'
import { toQuizYaml, toQuizYamlObject } from './quiz-yaml'

const def = (over: Partial<QuizDefinition> = {}): QuizDefinition => ({
  title: 'Photosynthesis',
  description: 'A check on today.',
  questions: [
    {
      type: 'single_choice',
      question: 'Where does photosynthesis occur?',
      choices: ['Chloroplasts', 'Mitochondria', 'Nucleus'],
      correctIndex: 0,
      points: 2,
    },
    {
      type: 'single_choice',
      question: 'What gas is released?',
      choices: ['Oxygen', 'Carbon dioxide'],
      correctIndex: 0,
    },
  ],
  ...over,
})

describe('toQuizYamlObject', () => {
  it('maps each question to a single_choice with one correct option', () => {
    const obj = toQuizYamlObject(def())
    expect(obj.version).toBe(1)
    expect(obj.title).toBe('Photosynthesis')
    expect(obj.description).toBe('A check on today.')
    expect(obj.isQuiz).toBe(true)
    expect(obj.emailCollection).toBe('verified')

    const q1 = obj.questions[0]!
    expect(q1.type).toBe('single_choice')
    expect(q1.points).toBe(2)
    expect(q1.options).toEqual([
      { value: 'Chloroplasts', isCorrect: true },
      { value: 'Mitochondria' },
      { value: 'Nucleus' },
    ])
    // Exactly one option is flagged correct
    expect(q1.options!.filter(o => o.isCorrect)).toHaveLength(1)
  })

  it('maps multiple_choice, short_text, and long_text questions (QUIZ-7)', () => {
    const obj = toQuizYamlObject(
      def({
        questions: [
          {
            type: 'multiple_choice',
            question: 'Select all gases involved.',
            choices: ['Oxygen', 'CO2', 'Helium'],
            correctIndexes: [0, 1],
          },
          {
            type: 'short_text',
            question: 'One-word product?',
            correctAnswers: ['glucose'],
          },
          { type: 'long_text', question: 'Explain the process.' },
        ],
      }),
    )
    const [mc, short, long] = obj.questions
    expect(mc!.type).toBe('multiple_choice')
    expect(mc!.options!.filter(o => o.isCorrect)).toHaveLength(2)
    expect(short!.type).toBe('short_text')
    expect(short!.correctAnswers).toEqual(['glucose'])
    expect(short!.options).toBeUndefined()
    expect(long!.type).toBe('long_text')
    expect(long!.options).toBeUndefined()
    expect(long!.correctAnswers).toBeUndefined()
  })

  it('throws on multiple_choice with no correct answers', () => {
    expect(() =>
      toQuizYamlObject(
        def({
          questions: [
            {
              type: 'multiple_choice',
              question: 'Q',
              choices: ['a', 'b'],
              correctIndexes: [],
            },
          ],
        }),
      ),
    ).toThrow(/invalid correctIndexes/)
  })

  it('defaults points to 1 and honors overrides', () => {
    const obj = toQuizYamlObject(def(), { defaultPoints: 5 })
    // Q1 keeps its own points; Q2 (no points) takes the default
    expect(obj.questions[0]!.points).toBe(2)
    expect(obj.questions[1]!.points).toBe(5)
  })

  it('omits description when absent and applies survey/email options', () => {
    const obj = toQuizYamlObject(def({ description: undefined }), {
      isQuiz: false,
      emailCollection: 'none',
    })
    expect('description' in obj).toBe(false)
    expect(obj.isQuiz).toBe(false)
    expect(obj.emailCollection).toBe('none')
  })

  it('throws on a quiz with no questions', () => {
    expect(() => toQuizYamlObject(def({ questions: [] }))).toThrow(
      /no questions/,
    )
  })

  it('throws on a question with fewer than two choices', () => {
    expect(() =>
      toQuizYamlObject(
        def({
          questions: [
            {
              type: 'single_choice',
              question: 'Q',
              choices: ['only'],
              correctIndex: 0,
            },
          ],
        }),
      ),
    ).toThrow(/fewer than two choices/)
  })

  it('throws on an out-of-range correctIndex', () => {
    expect(() =>
      toQuizYamlObject(
        def({
          questions: [
            {
              type: 'single_choice',
              question: 'Q',
              choices: ['a', 'b'],
              correctIndex: 5,
            },
          ],
        }),
      ),
    ).toThrow(/out-of-range/)
  })
})

describe('toQuizYaml', () => {
  it('produces YAML that parses back to the same structure', () => {
    const yaml = toQuizYaml(def())
    const parsed = YAML.parse(yaml)
    expect(parsed).toEqual(toQuizYamlObject(def()))
  })

  it('writes top-level keys in the library-documented order', () => {
    const yaml = toQuizYaml(def())
    const keys = [
      'version',
      'title',
      'description',
      'isQuiz',
      'emailCollection',
    ]
    const positions = keys.map(k => yaml.indexOf(`${k}:`))
    // Strictly increasing => documented order preserved
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!)
    }
  })
})
