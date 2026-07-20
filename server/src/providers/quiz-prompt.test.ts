/**
 * Unit tests for quiz prompt loading: slide-block rendering (skipping empty
 * slides), placeholder filling from the real externalized template, and the
 * loud failure on an unknown placeholder.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
const testEnv = vi.hoisted(() => ({
  PROMPTS_DIR: new URL('../../../config/prompts', import.meta.url).pathname,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import {
  renderSlidesBlock,
  renderQuizPrompt,
  resetQuizPromptCache,
} from './quiz-prompt'

afterEach(() => resetQuizPromptCache())

describe('renderSlidesBlock', () => {
  it('numbers slides and includes title, body, and bullets', () => {
    const block = renderSlidesBlock([
      {
        title: 'Photosynthesis',
        body: 'Light to energy',
        bullets: ['Uses CO2'],
      },
      { title: 'Cells' },
    ])
    expect(block).toContain('Slide 1:')
    expect(block).toContain('Photosynthesis')
    expect(block).toContain('Light to energy')
    expect(block).toContain('- Uses CO2')
    expect(block).toContain('Slide 2:')
    expect(block).toContain('Cells')
  })

  it('skips slides with no text so blanks cannot pad the source', () => {
    const block = renderSlidesBlock([
      { title: '  ', body: '', bullets: ['   '] },
      { title: 'Real slide' },
    ])
    // The empty slide is dropped, so the real one is numbered Slide 1
    expect(block).toBe('Slide 1:\nReal slide')
  })

  it('returns an empty string when nothing has text', () => {
    expect(renderSlidesBlock([{ title: '' }, {}])).toBe('')
  })
})

describe('renderQuizPrompt', () => {
  it('fills the questionCount and slides placeholders from quiz.txt', () => {
    const prompt = renderQuizPrompt({
      questionCount: '3',
      slides: 'Slide 1:\nPhotosynthesis',
    })
    expect(prompt).toContain('EXACTLY 3 questions')
    expect(prompt).toContain('Photosynthesis')
    // The output contract is spelled out for the model
    expect(prompt).toContain('"correctIndex"')
  })

  it('throws on an unknown placeholder rather than filling silently', () => {
    // The real template only uses known slots, so simulate a typo by
    // withholding a slot the template needs.
    expect(() => renderQuizPrompt({ questionCount: '3' })).toThrow(
      /unknown placeholder/,
    )
  })
})
