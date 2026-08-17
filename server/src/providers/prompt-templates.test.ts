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
  templateInstructions: '',
  projectSeed: '',
  deckSeed: '',
  rolling: 'ROLLING',
  deckStructure: '',
  capacity: '',
  currentTranscript: '',
  voiceCommands: '',
  updateRules: '',
  currentDeclared: '',
  lockLayout: '',
  pinLayout: '',
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

/**
 * What a design asks the model for, deck-wide (GEN-11).
 *
 * A slot description says what belongs in one box. This says who the whole
 * lecture is for — the audience, the register, the words to avoid — which
 * would otherwise have to be repeated on every box that holds prose.
 */
describe("the design's own instruction", () => {
  it('reaches the prompt when the design has one', () => {
    resetPromptCache()
    const prompt = renderGenerationPrompt({
      ...allSlots,
      templateInstructions:
        '\nThe design this lecture uses asks for:\nWrite for nine-year-olds.\n',
    })
    expect(prompt).toContain('Write for nine-year-olds.')
  })

  it('leaves no trace when the design says nothing', () => {
    resetPromptCache()
    const prompt = renderGenerationPrompt({ ...allSlots })
    // Not a blank line, not a dangling label: most designs say nothing, and
    // every byte of this prompt is latency on a call that runs per phrase.
    expect(prompt).not.toContain('The design this lecture uses asks for')
  })
})
