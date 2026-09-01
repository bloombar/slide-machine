/**
 * Unit tests for refinement prompt loading: each template fills its
 * placeholders from the real externalized files, optional fragments collapse
 * when empty, and an unknown placeholder fails loudly.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
const testEnv = vi.hoisted(() => ({
  PROMPTS_DIR: new URL('../../../config/prompts', import.meta.url).pathname,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import {
  renderRefinePrompt,
  renderRefineSplitPrompt,
  renderNarratePrompt,
  renderReformatPrompt,
  renderRefitPrompt,
  resetRefinePromptCache,
} from './refine-prompts'

afterEach(() => resetRefinePromptCache())

describe('renderRefinePrompt', () => {
  it('fills level, slide, transcript, layouts, and optional context/language', () => {
    const prompt = renderRefinePrompt({
      level: '4',
      current: '{"title":"Stars"}',
      transcript:
        '\n\nOriginal spoken transcript for this slide:\nWHAT WAS SAID',
      context: '\n\nLecture context:\nSEED',
      language: '\n\nWrite the slide text in: fr',
      layouts: '- content: General slide',
      load: '',
      split: '',
    })
    expect(prompt).toContain('Refinement strength 4 of 5')
    expect(prompt).toContain('{"title":"Stars"}')
    expect(prompt).toContain('what the instructor actually said')
    expect(prompt).toContain(
      'Original spoken transcript for this slide:\nWHAT WAS SAID',
    )
    expect(prompt).toContain('Lecture context:\nSEED')
    expect(prompt).toContain('Write the slide text in: fr')
    expect(prompt).toContain('- content: General slide')
    expect(prompt).toContain('"imageGuidance"')
  })

  it('collapses empty optional fragments', () => {
    const prompt = renderRefinePrompt({
      level: '2',
      current: '{}',
      transcript: '',
      context: '',
      language: '',
      layouts: '- content: x',
      load: '',
      split: '',
    })
    expect(prompt).not.toContain('Original spoken transcript')
    expect(prompt).not.toContain('Lecture context')
    expect(prompt).not.toContain('Write the slide text in')
  })

  /**
   * A refine the instructor did not allow to split must not be shown the
   * split instructions at all. Not a matter of ignoring the reply later: a
   * model that is never told the shape exists cannot spend tokens filling it,
   * and cannot be tempted to divide a slide nobody asked it to divide.
   */
  it('says nothing about splitting when the split fragment is empty', () => {
    const prompt = renderRefinePrompt({
      level: '2',
      current: '{}',
      transcript: '',
      context: '',
      language: '',
      layouts: '- content: x',
      load: '',
      split: '',
    })
    expect(prompt).not.toContain('splitProposal')
    expect(prompt).not.toContain('SEPARATE IDEAS')
  })
})

describe('renderRefineSplitPrompt', () => {
  it('states the cap, that the split is applied, and when to decline', () => {
    const prompt = renderRefineSplitPrompt({ maxSplitParts: '3' })
    expect(prompt).toContain('WILL BE APPLIED')
    expect(prompt).toContain('Never return more than 3 parts')
    expect(prompt).toContain('CLOSE CALL')
    expect(prompt).toContain('"splitProposal"')
  })

  it('is what puts the split instructions into a refine prompt', () => {
    const prompt = renderRefinePrompt({
      level: '2',
      current: '{}',
      transcript: '',
      context: '',
      language: '',
      layouts: '- content: x',
      load: '',
      split: renderRefineSplitPrompt({ maxSplitParts: '3' }),
    })
    expect(prompt).toContain('"splitProposal"')
    expect(prompt).toContain('SEPARATE IDEAS')
  })
})

describe('renderNarratePrompt', () => {
  it('fills eloquence, student framing, and a prior narration to refine', () => {
    const prompt = renderNarratePrompt({
      level: '5',
      studentContext: '\nThis slide represents a STUDENT question or comment',
      turns: '',
      language: '\nLanguage: es.',
      transcript: '\n\nCurrent narration to refine:\nPRIOR NARRATION',
      slide: '{"title":"Q"}',
    })
    expect(prompt).toContain('Eloquence 5 of 5')
    expect(prompt).toContain('refine and improve THAT further')
    expect(prompt).toContain('STUDENT question')
    expect(prompt).toContain('Language: es.')
    expect(prompt).toContain('Current narration to refine:\nPRIOR NARRATION')
    expect(prompt).toContain('"transcript": string')
  })

  it('omits the student framing and prior narration when absent', () => {
    const prompt = renderNarratePrompt({
      level: '1',
      studentContext: '',
      turns: '',
      language: '',
      transcript: '',
      slide: '{}',
    })
    expect(prompt).not.toContain('STUDENT question')
    expect(prompt).not.toContain('Language:')
    expect(prompt).not.toContain('Current narration to refine')
  })
})

describe('renderReformatPrompt', () => {
  it('fills the current slide, transcript, and layouts', () => {
    const prompt = renderReformatPrompt({
      current: '{"title":"T"}',
      transcript: '[LECTURER] hello\n[STUDENT] why?',
      context: '',
      language: '',
      layouts: '- quote: A single statement',
    })
    expect(prompt).toContain('speakers are known')
    expect(prompt).toContain('[STUDENT] why?')
    expect(prompt).toContain('- quote: A single statement')
  })
})

describe('renderRefitPrompt', () => {
  it('names both layouts, the boxes to fill, and the orphaned content', () => {
    const prompt = renderRefitPrompt({
      fromLayout: 'Content',
      fromSlots: '- "body" (Slide body; text): "A paragraph"',
      toLayout: 'List',
      toPurpose: 'A title plus bullet points',
      toSlots: '- "bullets" (Slide bullets; bullets; max 5 items): empty',
      fill: '- "bullets" (Slide bullets; bullets; max 5 items): empty',
      orphaned:
        '\nContent that no longer has a box (use this first):\n- "body" (Slide body; text): "A paragraph"',
      context: '',
      language: '',
    })
    expect(prompt).toContain('"Content"')
    expect(prompt).toContain('"List" — A title plus bullet points')
    expect(prompt).toContain('Boxes to fill')
    expect(prompt).toContain('no longer has a box')
    // The instruction that keeps carried-over content safe must survive
    // any re-wording of the file.
    expect(prompt).toContain('Do NOT rewrite those')
  })

  it('collapses the orphan and context fragments when empty', () => {
    const prompt = renderRefitPrompt({
      fromLayout: 'Content',
      fromSlots: '- "title"',
      toLayout: 'List',
      toPurpose: 'Points',
      toSlots: '- "bullets"',
      fill: '- "bullets"',
      orphaned: '',
      context: '',
      language: '',
    })
    // The rules still explain what orphaned content is; what collapses is
    // the section that would have listed some.
    expect(prompt).not.toContain('Content that no longer has a box (use')
    expect(prompt).not.toContain('Lecture context')
  })
})

describe('unknown placeholders', () => {
  it('throw rather than filling silently', () => {
    // Withhold a slot the template needs to simulate a typo.
    expect(() => renderRefinePrompt({ level: '2' })).toThrow(
      /refine\.txt uses unknown placeholder/,
    )
  })
})

/**
 * Markdown surviving a post-lecture pass.
 *
 * Refine, reformat and re-fit all rewrite the same text boxes the live
 * generation prompt fills, and a rewrite that does not know slot text is
 * Markdown flattens the emphasis, the code spans and the links out of a slide
 * that already had them. Each template is checked on its own: the three are
 * separate files, and one carrying the line says nothing about the others.
 */
describe('Markdown in the post-lecture prompts', () => {
  const refine = () =>
    renderRefinePrompt({
      level: '3',
      current: '{}',
      transcript: '',
      context: '',
      language: '',
      layouts: '- content: x',
      load: '',
      split: '',
    })

  const reformat = () =>
    renderReformatPrompt({
      current: '{}',
      transcript: 'LECTURER: x',
      context: '',
      language: '',
      layouts: '- content: x',
    })

  const refit = () =>
    renderRefitPrompt({
      fromLayout: 'content',
      fromSlots: '- title',
      toLayout: 'list',
      toPurpose: 'points',
      toSlots: '- bullets',
      fill: '- bullets',
      orphaned: '',
      context: '',
      language: '',
    })

  it('tells refine the slide text is Markdown, and to keep it', () => {
    const prompt = refine()
    expect(prompt).toContain('Slot text is Markdown')
    expect(prompt).toContain('[links](https://example.com)')
    expect(prompt).toContain('No headings, no ``` fences, no $…$ maths')
  })

  it('tells reformat the same', () => {
    const prompt = reformat()
    expect(prompt).toContain('Slot text is Markdown')
    expect(prompt).toContain('[links](https://example.com)')
  })

  it('tells a re-fit to carry the markup across rather than flatten it', () => {
    const prompt = refit()
    expect(prompt).toContain('Text and bullets are Markdown')
    expect(prompt).toContain('rather than flattening them')
  })
})
