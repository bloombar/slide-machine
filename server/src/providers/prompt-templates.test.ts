/**
 * Unit tests for the externalized prompt templates: the real files in
 * config/prompts load and render, every placeholder resolves, the
 * freedom bands cover 1-5, and template typos fail loudly.
 */
import { describe, it, expect } from 'vitest'
import {
  freedomPolicy,
  renderGenerationPrompt,
  resetPromptCache,
} from './prompt-templates'

const allSlots = {
  outputShape: '{SHAPE}',
  freedomPolicy: 'FREEDOM-POLICY',
  layouts: 'LAYOUTS',
  seededImages: '',
  projectSeed: '',
  deckSeed: '',
  rolling: 'ROLLING',
  capacity: '',
  voiceCommands: '',
  updateRules: '',
  lockLayout: '',
  language: '',
  deckTitle: '',
  phrase: 'the phrase',
}

describe('prompt templates', () => {
  it('renders the real template with every placeholder resolved', () => {
    resetPromptCache()
    const prompt = renderGenerationPrompt(allSlots)
    expect(prompt).toContain('{SHAPE}')
    expect(prompt).toContain('FREEDOM-POLICY')
    expect(prompt).toContain('LAYOUTS')
    expect(prompt).toContain('New phrase: "the phrase"')
    // No unfilled placeholders survive
    expect(prompt).not.toMatch(/\{\{\w+\}\}/)
  })

  it('fails loudly when the template names an unknown slot', () => {
    resetPromptCache()
    const { phrase: _dropped, ...missingOne } = allSlots
    void _dropped
    expect(() => renderGenerationPrompt(missingOne)).toThrow(
      /unknown placeholder \{\{phrase\}\}/,
    )
  })

  it('covers the whole 1-5 range with banded policies', () => {
    resetPromptCache()
    for (let n = 1; n <= 5; n++) {
      const policy = freedomPolicy(n)
      expect(policy).toContain(`CONTENT FREEDOM ${n}/5`)
      expect(policy.length).toBeGreaterThan(60)
    }
    // Distinct bands at the extremes
    expect(freedomPolicy(1)).not.toBe(freedomPolicy(5))
    // Out-of-range values clamp
    expect(freedomPolicy(0)).toContain('1/5')
    expect(freedomPolicy(99)).toContain('5/5')
  })
})
