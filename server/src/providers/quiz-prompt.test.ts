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
  renderTranscriptBlock,
  renderAvoidBlock,
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

describe('renderTranscriptBlock', () => {
  it('is empty when no transcript is supplied', () => {
    expect(renderTranscriptBlock()).toBe('')
    expect(renderTranscriptBlock('   ')).toBe('')
  })

  it('labels and includes the transcript text when supplied', () => {
    const block = renderTranscriptBlock('Mitochondria make ATP.')
    expect(block).toContain('Spoken transcript')
    expect(block).toContain('Mitochondria make ATP.')
  })

  it('truncates a very long transcript to keep the prompt bounded', () => {
    const long = 'a'.repeat(20000)
    const block = renderTranscriptBlock(long)
    expect(block.length).toBeLessThan(long.length)
    expect(block).toContain('…')
  })
})

describe('renderAvoidBlock', () => {
  it('is empty when there are no prior questions', () => {
    expect(renderAvoidBlock()).toBe('')
    expect(renderAvoidBlock([])).toBe('')
    expect(renderAvoidBlock(['   '])).toBe('')
  })

  it('lists prior questions under a do-not-repeat instruction', () => {
    const block = renderAvoidBlock(['What is a cell?', 'Define osmosis.'])
    expect(block).toContain('Do NOT repeat')
    expect(block).toContain('- What is a cell?')
    expect(block).toContain('- Define osmosis.')
  })

  it('caps the number of questions listed', () => {
    const many = Array.from({ length: 100 }, (_, i) => `Q${i}?`)
    const bullets = renderAvoidBlock(many)
      .split('\n')
      .filter(l => l.startsWith('- '))
    expect(bullets.length).toBeLessThanOrEqual(40)
  })
})

describe('renderQuizPrompt', () => {
  it('fills every placeholder from quiz.txt', () => {
    const prompt = renderQuizPrompt({
      questionCount: '3',
      slides: 'Slide 1:\nPhotosynthesis',
      transcript: renderTranscriptBlock('Spoken words here.'),
      avoid: renderAvoidBlock(['An old question?']),
    })
    expect(prompt).toContain('EXACTLY 3 questions')
    expect(prompt).toContain('Photosynthesis')
    // The output contract is spelled out for the model
    expect(prompt).toContain('"correctIndex"')
    // The optional sections land in the prompt
    expect(prompt).toContain('Spoken words here.')
    expect(prompt).toContain('An old question?')
  })

  it('leaves optional slots blank without error', () => {
    const prompt = renderQuizPrompt({
      questionCount: '3',
      slides: 'Slide 1:\nPhotosynthesis',
      transcript: '',
      avoid: '',
    })
    expect(prompt).toContain('EXACTLY 3 questions')
    expect(prompt).not.toContain('Spoken transcript')
    expect(prompt).not.toContain('Do NOT repeat')
  })

  it('throws on an unknown placeholder rather than filling silently', () => {
    // The real template only uses known slots, so simulate a typo by
    // withholding a slot the template needs.
    expect(() => renderQuizPrompt({ questionCount: '3' })).toThrow(
      /unknown placeholder/,
    )
  })
})
