/**
 * Unit tests for the Gemini adapter against a stubbed fetch: prompt
 * assembly (seed layers, layouts, seeded images), response parsing and
 * validation, layout/seeded-id drift correction, and failure modes.
 * The live API is never called from tests.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type { SlideGenerationRequest } from '@slide-machine/shared'
import { VOICE_COMMAND_DESCRIPTORS } from '@slide-machine/shared'
const testEnv = vi.hoisted(() => ({
  GEMINI_API_KEY: 'test-key' as string | undefined,
  GEMINI_MODEL: 'gemini-test-model',
  GEMINI_TIMEOUT_MS: 5000,
  GENERATION_LOG_PROMPTS: false as boolean,
  // The real externalized templates: tests assert their content
  PROMPTS_DIR: new URL('../../../config/prompts', import.meta.url).pathname,
}))
vi.mock('../config/env', () => ({ env: testEnv }))

import { GeminiGenerationProvider, pingGemini } from './gemini-generation'
import { GenerationUnavailableError } from './errors'

const provider = new GeminiGenerationProvider()

const request = (
  overrides: Partial<SlideGenerationRequest> = {},
): SlideGenerationRequest => ({
  phrase: 'Photosynthesis converts light into chemical energy',
  rollingContext: ['Photosynthesis Basics — an overview'],
  seedContext: {
    project: 'PROJECT-SEED biology fundamentals',
    deck: 'DECK-SEED chloroplast structure today',
  },
  layoutDescriptors: [
    {
      type: 'content',
      label: 'Content',
      purpose: 'General slide',
      slots: [
        { name: 'title', kind: 'text', label: 'Slide title', maxChars: 50 },
        { name: 'body', kind: 'text', label: 'Slide body' },
      ],
      constraints: { maxBodyChars: 400 },
    },
    {
      type: 'list',
      label: 'Bullet list',
      purpose: '3-6 parallel points',
      slots: [
        { name: 'title', kind: 'text', label: 'Slide title' },
        { name: 'bullets', kind: 'bullets', label: 'Slide bullets' },
      ],
      constraints: { maxBullets: 6 },
    },
  ],
  seededImages: [
    {
      id: 'asset1',
      caption: 'Chloroplast micrograph',
      keywords: ['chloroplast'],
    },
  ],
  currentSlide: { layoutType: 'list', bulletCount: 5, bodyChars: 0 },
  ...overrides,
})

const geminiReply = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload),
  json: async () => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  }),
})

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  testEnv.GEMINI_API_KEY = 'test-key'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('slot metadata reaching the model (TMPL-10)', () => {
  /** The prompt the adapter actually sent. */
  const promptFor = async (req: SlideGenerationRequest): Promise<string> => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'new', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(req)
    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse(String(init.body))
    return body.contents[0].parts[0].text as string
  }

  const authored = (slot: Record<string, unknown>) =>
    request({
      layoutDescriptors: [
        {
          type: 'content',
          label: 'Content',
          purpose: 'General slide',
          slots: [
            { name: 'title', kind: 'text', label: 'Slide title' },
            { name: 'example', kind: 'text', label: 'Worked example', ...slot },
          ],
        },
      ],
    } as Partial<SlideGenerationRequest>)

  it('sends the author’s instruction with the box it describes', async () => {
    const prompt = await promptFor(
      authored({ description: 'A runnable Python snippet, at most 8 lines.' }),
    )
    // The mechanism by which a subject-specific template produces
    // subject-appropriate slides
    expect(prompt).toContain('A runnable Python snippet, at most 8 lines.')
    expect(prompt).toContain('example')
  })

  it('sends a word ceiling and a required flag alongside it', async () => {
    const prompt = await promptFor(
      authored({ maxWords: 40, required: true, description: 'A summary.' }),
    )
    expect(prompt).toContain('max 40 words')
    expect(prompt).toContain('required')
  })

  it('says nothing extra for a box the author did not describe', async () => {
    const prompt = await promptFor(authored({}))
    // A box's name and kind are the least it can be described by (GEN-11);
    // beyond that, spending prompt on an undescribed box would cost latency
    // on every phrase for nothing
    expect(prompt).toContain('title[text] "Slide title", example[text]')
  })

  it('sends the author’s own name for the box', async () => {
    const prompt = await promptFor(authored({}))
    // "Worked example" says what `example` is for better than the slot name
    // does — and it is what the author wrote (GEN-11)
    expect(prompt).toContain('"Worked example"')
  })

  it('names each box’s kind, so the model writes the right thing in it', async () => {
    const prompt = await promptFor(
      authored({ kind: 'code', options: { language: 'python' } }),
    )
    // A code box gets a program listing, not a paragraph — and the language
    // the template declared, so the listing is in it
    expect(prompt).toContain('example[code:python]')
    // ...and the shape that kind expects is explained once, above the menu
    expect(prompt).toContain('no markdown fence')
  })

  it('explains only the kinds this template actually uses', async () => {
    const prompt = await promptFor(authored({}))
    // A history template told how to write LaTeX spends the budget on a box
    // that does not exist, and invites a formula nobody asked for
    expect(prompt).not.toContain('LaTeX')
  })

  it('drops instructions rather than truncating, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const long = 'y'.repeat(190)
    const manySlots = Array.from({ length: 40 }, (_, i) => ({
      name: `box-${i}`,
      kind: 'text' as const,
      label: `Box ${i}`,
      description: long,
    }))
    const prompt = await promptFor(
      request({
        layoutDescriptors: [
          {
            type: 'content',
            label: 'Content',
            purpose: 'General slide',
            slots: manySlots,
          },
        ],
      } as Partial<SlideGenerationRequest>),
    )
    // Every box is still offered — only the instructions gave way
    expect(prompt).toContain('box-39')
    expect(prompt).not.toContain(long)
    // ...and never silently: the author has no other way to find out
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('dropped slot instructions'),
    )
    warn.mockRestore()
  })
})

describe('GeminiGenerationProvider', () => {
  it('assembles the prompt from layers, layouts, and seeded images', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'content',
        slots: { title: 'Photosynthesis', body: 'Light to energy' },
      }),
    )
    await provider.generateSlideContent(request())

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain(':generateContent')
    const body = JSON.parse(String(init.body))
    const prompt = body.contents[0].parts[0].text as string
    // Both seed layers present, lecture layer marked more specific
    expect(prompt).toContain('PROJECT-SEED')
    expect(prompt).toContain('DECK-SEED')
    expect(prompt.indexOf('more specific')).toBeGreaterThan(0)
    // The layout option set and constraints are spelled out, with
    // per-slot budgets riding on the slot names
    expect(prompt).toContain('"content" (Content)')
    expect(prompt).toContain('title[text] "Slide title" (max 50 chars)')
    expect(prompt).toContain('maxBullets')
    // Seeded images are offered by id
    expect(prompt).toContain('id "asset1"')
    // JSON output via mime type + prompt contract (deliberately no
    // responseSchema — constrained decoding degenerates; see DECISIONS)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema).toBeUndefined()
    expect(body.generationConfig.maxOutputTokens).toBe(2048)
    expect(prompt).toContain('"action": "new" | "update" | "none"')
    // Capacity guidance: current load and the prefer-new bias
    expect(prompt).toContain('Current slide load: 5 bullets')
    expect(prompt).toContain('Prefer "new" whenever in doubt')
    // No language resolved anywhere: no language directive
    expect(prompt).not.toContain('IETF tag')
    // The key travels in a header, never the URL
    expect(String(url)).not.toContain('test-key')
    expect(init.headers['x-goog-api-key']).toBe('test-key')
  })

  it('renders deck-structure outline + signals + heading guidance when present', async () => {
    fetchMock.mockResolvedValue(geminiReply({ action: 'none' }))
    await provider.generateSlideContent(
      request({
        deckStructure: {
          totalSlides: 9,
          slidesSinceHeader: 5,
          hasTitleSlide: true,
          outline: [
            { position: 1, layoutType: 'title', title: 'Fractions' },
            { position: 4, layoutType: 'section', title: 'Adding Fractions' },
          ],
        },
      }),
    )
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain('9 slide(s), 5 since the last heading')
    expect(prompt).toContain('HAS an opening title slide')
    expect(prompt).toContain('1. [title] Fractions')
    expect(prompt).toContain('4. [section] Adding Fractions')
    // The heading instructions ride with the data, so the flag toggles both.
    expect(prompt).toContain('"section" layout to open a NEW major topic')
  })

  it('omits deck-structure data and instructions when absent (flag off / empty deck)', async () => {
    fetchMock.mockResolvedValue(geminiReply({ action: 'none' }))
    // request() has no deckStructure by default.
    await provider.generateSlideContent(request())
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).not.toContain('Deck structure so far')
    expect(prompt).not.toContain('"section" layout to open a NEW major topic')
  })

  it('offers same-layout rephrasing and the slide transcript only when enabled', async () => {
    fetchMock.mockResolvedValue(geminiReply({ action: 'none' }))
    const promptFor = () =>
      JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0].parts[0]
        .text as string

    // Rephrasing on: a refit may keep the same layout, and the slide's spoken
    // transcript is passed for context.
    await provider.generateSlideContent(
      request({
        allowLayoutRefit: true,
        allowRephrase: true,
        currentSlide: {
          layoutType: 'list',
          bulletCount: 2,
          bodyChars: 0,
          content: { title: 'T', bullets: ['a', 'b'] },
          sourceTranscript: 'spoken words so far about the topic',
        },
      }),
    )
    let prompt = promptFor()
    expect(prompt).toContain('keep the SAME layoutType')
    expect(prompt).toContain('spoken words so far about the topic')

    // Rephrasing off: a refit is strictly for genuine layout changes.
    fetchMock.mockClear()
    await provider.generateSlideContent(
      request({
        allowLayoutRefit: true,
        allowRephrase: false,
        currentSlide: {
          layoutType: 'list',
          bulletCount: 2,
          bodyChars: 0,
          content: { title: 'T', bullets: ['a', 'b'] },
        },
      }),
    )
    prompt = promptFor()
    expect(prompt).toContain('the layoutType must actually change')
    expect(prompt).not.toContain('keep the SAME layoutType')
  })

  it('forbids updating a whiteboard current slide and never surfaces its layout', async () => {
    fetchMock.mockResolvedValue(geminiReply({ action: 'none' }))
    await provider.generateSlideContent(
      request({
        allowLayoutRefit: true,
        allowRephrase: true,
        currentSlide: {
          layoutType: 'whiteboard',
          bulletCount: 0,
          bodyChars: 0,
          content: { title: undefined },
          sourceTranscript: 'spoken words while annotating',
        },
      }),
    )
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    // The model is told the canvas can't be updated and to go "new"...
    expect(prompt).toContain('freehand whiteboard drawing canvas')
    expect(prompt).toContain('NEVER output layoutType "whiteboard"')
    // ...its "load" is never surfaced (that invited the update bug)...
    expect(prompt).not.toContain('Current slide load')
    // ...and no update/delta rules that reference its non-selectable layout
    // (this text is unique to the updateRules fragment, unlike the "delta"
    // token that always appears in the JSON output shape).
    expect(prompt).not.toContain('keep the SAME layoutType')
    expect(prompt).not.toContain('Current slide content:')
  })

  it("pins a heading slide's layout and sends new content to a new slide", async () => {
    fetchMock.mockResolvedValue(geminiReply({ action: 'none' }))
    const heading = {
      layoutType: 'title' as const,
      bulletCount: 0,
      bodyChars: 0,
      content: { title: 'Fractions' },
    }
    // Without the flag the fragment is absent, even on a title slide
    await provider.generateSlideContent(
      request({ allowLayoutRefit: true, currentSlide: heading }),
    )
    const unpinned = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(unpinned).not.toContain('introduces a topic')

    await provider.generateSlideContent(
      request({
        allowLayoutRefit: true,
        pinLayout: true,
        currentSlide: heading,
      }),
    )
    const prompt = JSON.parse(String(fetchMock.mock.calls[1]![1].body))
      .contents[0].parts[0].text as string
    // The heading's layout is fixed, refit is off the table for it, and
    // anything needing body/bullets must open a new slide
    expect(prompt).toContain('introduces a topic rather than accumulating')
    expect(prompt).toContain('keep layoutType EXACTLY "title"')
    expect(prompt).toContain('never "refit" it to a different layout')
    expect(prompt).toContain('must be a "new" slide')
  })

  it('tolerates responses that omit layoutType (none / delta updates)', async () => {
    // A bare "none" — exactly what the live model returned mid-lecture
    fetchMock.mockResolvedValue(geminiReply({ action: 'none' }))
    let result = await provider.generateSlideContent(request())
    expect(result.action).toBe('none')

    // An update without a layout claim keeps the slide's own layout
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'update', slots: { bullets: ['more'] } }),
    )
    result = await provider.generateSlideContent(request())
    expect(result.action).toBe('update')
    expect(result.layoutType).toBe('list') // currentSlide.layoutType
  })

  it('asks for and accepts a deck title only when requested', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'content',
        slots: { title: 'T' },
        deckTitle: '  Photosynthesis 101  ',
      }),
    )
    let result = await provider.generateSlideContent(
      request({ suggestDeckTitle: true }),
    )
    let prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain('"deckTitle"?: string')
    // Prompt asks the model to keep refining the title, not set it once
    expect(prompt).toContain('Refine it')
    expect(result.deckTitle).toBe('Photosynthesis 101')

    // Unrequested claims are dropped, and the prompt never mentions it
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'content',
        slots: { title: 'T' },
        deckTitle: 'Sneaky',
      }),
    )
    result = await provider.generateSlideContent(request())
    prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0]
      .parts[0].text as string
    expect(prompt).not.toContain('deckTitle')
    expect(result.deckTitle).toBeUndefined()
  })

  it('pins the output language when the request resolves one', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request({ language: 'fr' }))
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain(
      'Write ALL slide text in the language with IETF tag "fr"',
    )
  })

  it('anchors the content-freedom policy to the numeric setting', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request({ freedom: 1 }))
    let prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain('CONTENT FREEDOM 1/5')
    expect(prompt).toContain('NEVER add topics')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request({ freedom: 5 }))
    prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0]
      .parts[0].text as string
    expect(prompt).toContain('CONTENT FREEDOM 5/5')
    expect(prompt).toContain('elaborate freely')

    // Default without a setting: 2/5
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request({ freedom: undefined }))
    prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0]
      .parts[0].text as string
    expect(prompt).toContain('CONTENT FREEDOM 2/5')
  })

  it('parses a valid structured response', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'update',
        layoutType: 'list',
        slots: { bullets: ['light reactions', 'dark reactions'] },
        imageGuidance: { keywords: ['chloroplast', 'diagram'] },
      }),
    )
    const result = await provider.generateSlideContent(request())
    expect(result).toEqual({
      action: 'update',
      layoutType: 'list',
      slots: { bullets: ['light reactions', 'dark reactions'] },
      imageGuidance: {
        keywords: ['chloroplast', 'diagram'],
        seededImageId: undefined,
        none: undefined,
      },
    })
  })

  it('coerces layouts and seeded ids the model invented', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'hologram',
        slots: { title: 'X' },
        imageGuidance: { keywords: ['x'], seededImageId: 'not-offered' },
      }),
    )
    const result = await provider.generateSlideContent(request())
    expect(result.layoutType).toBe('content')
    expect(result.imageGuidance?.seededImageId).toBeUndefined()
  })

  it('honors a valid seeded image selection', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'content',
        slots: { title: 'Chloroplasts' },
        imageGuidance: { keywords: ['chloroplast'], seededImageId: 'asset1' },
      }),
    )
    const result = await provider.generateSlideContent(request())
    expect(result.imageGuidance?.seededImageId).toBe('asset1')
  })

  it('offers refit semantics only when allowLayoutRefit rides along with slide content', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request())
    let prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).not.toContain('updateMode')
    expect(prompt).not.toContain('Current slide content:')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(
      request({
        allowLayoutRefit: true,
        currentSlide: {
          layoutType: 'content',
          bulletCount: 0,
          bodyChars: 40,
          content: { title: 'Membranes', body: 'A phospholipid bilayer' },
        },
      }),
    )
    prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0]
      .parts[0].text as string
    expect(prompt).toContain('"updateMode"?: "delta" | "refit"')
    expect(prompt).toContain('Keep layoutType "content"')
    expect(prompt).toContain(
      'Current slide content: {"title":"Membranes","body":"A phospholipid bilayer"}',
    )
  })

  it('passes updateMode through only when refit was offered', async () => {
    const reply = {
      action: 'update',
      updateMode: 'refit',
      layoutType: 'list',
      slots: { title: 'Membranes', bullets: ['bilayer', 'proteins'] },
    }
    fetchMock.mockResolvedValue(geminiReply(reply))
    let result = await provider.generateSlideContent(
      request({
        allowLayoutRefit: true,
        currentSlide: {
          layoutType: 'content',
          bulletCount: 0,
          bodyChars: 40,
          content: { title: 'Membranes', body: 'A phospholipid bilayer' },
        },
      }),
    )
    expect(result.updateMode).toBe('refit')
    expect(result.layoutType).toBe('list')

    // Same reply without the offer: the claim is stripped
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(geminiReply(reply))
    result = await provider.generateSlideContent(request())
    expect(result.updateMode).toBeUndefined()
  })

  it('offers the "command" action only when voice commands ride along', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request())
    let prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).not.toContain('"command"')
    expect(prompt).not.toContain('Command ids:')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(
      request({ voiceCommands: VOICE_COMMAND_DESCRIPTORS }),
    )
    prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).contents[0]
      .parts[0].text as string
    expect(prompt).toContain('"action": "new" | "update" | "none" | "command"')
    expect(prompt).toContain('Command ids:')
    expect(prompt).toContain('- "next": Advance to the next slide')
    expect(prompt).toContain('- "newSlide": Append a new blank slide')
  })

  it('returns a recognized command and drops any content fields', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'command',
        command: 'previous',
        layoutType: 'hologram',
        slots: { title: 'stray content' },
      }),
    )
    const result = await provider.generateSlideContent(
      request({ voiceCommands: VOICE_COMMAND_DESCRIPTORS }),
    )
    expect(result).toEqual({
      action: 'command',
      command: 'previous',
      layoutType: 'content',
      slots: {},
    })
  })

  it('degrades invented or unoffered command claims to none', async () => {
    // A command id we never defined
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'command', command: 'jazzhands', slots: {} }),
    )
    let result = await provider.generateSlideContent(
      request({ voiceCommands: VOICE_COMMAND_DESCRIPTORS }),
    )
    expect(result.action).toBe('none')
    expect(result.command).toBeUndefined()

    // A real id, but commands were never offered in this request
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'command', command: 'next', slots: {} }),
    )
    result = await provider.generateSlideContent(request())
    expect(result.action).toBe('none')
    expect(result.command).toBeUndefined()
  })

  it('salvages a drifted action label onto the contract vocabulary', async () => {
    // The live model sometimes labels a create as "create"/"add" or
    // suffixes it ("new slide"); these must resolve rather than 500 the
    // session (regression: resultSchema.parse threw on the enum).
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'create',
        layoutType: 'content',
        slots: { title: 'Chloroplasts', body: 'Site of photosynthesis' },
      }),
    )
    let result = await provider.generateSlideContent(request())
    expect(result.action).toBe('new')
    expect(result.slots).toEqual({
      title: 'Chloroplasts',
      body: 'Site of photosynthesis',
    })

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'new slide', slots: { title: 'X' } }),
    )
    result = await provider.generateSlideContent(request())
    expect(result.action).toBe('new')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'edit', slots: { bullets: ['more'] } }),
    )
    result = await provider.generateSlideContent(request())
    expect(result.action).toBe('update')
  })

  it('falls back to none for an action it cannot confidently remap', async () => {
    // An unknown verb is never guessed at — even with content present, a
    // mislabeled phrase quietly does nothing rather than risk a wrong slide.
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'zoop',
        layoutType: 'content',
        slots: { title: 'Ambiguous' },
      }),
    )
    let result = await provider.generateSlideContent(request())
    expect(result.action).toBe('none')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(geminiReply({ action: 'zoop', slots: {} }))
    result = await provider.generateSlideContent(request())
    expect(result.action).toBe('none')
  })

  it('instructs the model to use an exact action value, no synonyms', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request())
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain('EXACTLY one of the quoted values')
    expect(prompt).toContain('never a synonym')
  })

  it('asks for image keywords ordered by search relevance', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    await provider.generateSlideContent(request())
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    // Keyword order matters downstream: the first phrase seeds the manual
    // search box and each is searched independently and pooled.
    expect(prompt).toContain('ORDERED from most to least likely')
    expect(prompt).toContain('searched on its own')
  })

  it('drops a phrase whose output is malformed rather than throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // bullets must be string[]; a number fails validation and once threw
    fetchMock.mockResolvedValue(
      geminiReply({
        action: 'new',
        layoutType: 'content',
        slots: { bullets: 5 },
      }),
    )
    const result = await provider.generateSlideContent(request())
    expect(result.action).toBe('none')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('throws on other API errors with the status attached', async () => {
    // 429/503 map to friendly errors (covered below); other statuses keep
    // the raw status for debugging.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    })
    await expect(provider.generateSlideContent(request())).rejects.toThrow(
      /400/,
    )
  })

  it('throws on unparseable model output', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'not json {' }] } }],
      }),
    })
    await expect(provider.generateSlideContent(request())).rejects.toThrow(
      /unparseable/,
    )
  })

  it('throws when no candidate text comes back', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [] }),
    })
    await expect(provider.generateSlideContent(request())).rejects.toThrow(
      /no candidate/,
    )
  })

  it('dumps the prompt and raw response when logging is enabled', async () => {
    testEnv.GENERATION_LOG_PROMPTS = true
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchMock.mockResolvedValue(
      geminiReply({ action: 'none', layoutType: 'content', slots: {} }),
    )
    try {
      await provider.generateSlideContent(request())
      const logged = logSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(logged).toContain('===== GENERATION PROMPT')
      expect(logged).toContain('New phrase:')
      expect(logged).toContain('===== GENERATION RESPONSE')
    } finally {
      logSpy.mockRestore()
      testEnv.GENERATION_LOG_PROMPTS = false
    }
  })

  it('refuses to run without an API key', async () => {
    testEnv.GEMINI_API_KEY = undefined
    await expect(provider.generateSlideContent(request())).rejects.toThrow(
      /GEMINI_API_KEY/,
    )
  })

  it('maps quota/credit exhaustion (429) to a non-retryable friendly error', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429),
    )
    const err = await provider
      .generateSlideContent(request())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GenerationUnavailableError)
    expect((err as GenerationUnavailableError).retryable).toBe(false)
    expect((err as Error).message).toMatch(/quota or credits/)
  })

  it('maps provider overload (503) to a retryable friendly error', async () => {
    fetchMock.mockResolvedValue(geminiReply({ error: { code: 503 } }, 503))
    const err = await provider
      .generateSlideContent(request())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GenerationUnavailableError)
    expect((err as GenerationUnavailableError).retryable).toBe(true)
    expect((err as Error).message).toMatch(/temporarily busy/)
  })

  it('narrates from role turns: includes the turn block and drops the prior-narration base', async () => {
    fetchMock.mockResolvedValue(geminiReply({ transcript: 'narration' }))
    await provider.narrateSlide({
      slide: { layoutType: 'list', title: 'Osmosis', bullets: ['x'] },
      level: 2,
      turns: [
        { role: 'lecturer', text: 'Water crosses membranes' },
        { role: 'student', text: 'Does temperature affect it?' },
      ],
      transcript: 'A prior narration that must be ignored',
    })
    const prompt = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
      .contents[0].parts[0].text as string
    expect(prompt).toContain('[LECTURER] Water crosses membranes')
    expect(prompt).toContain('[STUDENT] Does temperature affect it?')
    expect(prompt).toContain('attribution')
    // With turns, the prior narration is not fed back (so nothing compounds).
    expect(prompt).not.toContain('A prior narration that must be ignored')
    expect(prompt).not.toContain('Current narration to refine')
  })
})

describe('refitSlideLayout', () => {
  const refitRequest = (overrides = {}) => ({
    from: {
      layoutType: 'content',
      label: 'Content',
      slots: [
        {
          name: 'body',
          kind: 'text' as const,
          label: 'Slide body',
          textStyle: 'body',
          value: 'Water moves across a membrane. Solutes stay put.',
        },
      ],
    },
    to: {
      layoutType: 'list',
      label: 'Bullet list',
      purpose: '3-6 parallel points',
      slots: [
        {
          name: 'bullets',
          kind: 'bullets' as const,
          label: 'Slide bullets',
          textStyle: 'bullet',
          maxItems: 2,
        },
        { name: 'title', kind: 'text' as const, label: 'Slide title' },
      ],
    },
    fill: ['bullets'],
    orphaned: [
      {
        name: 'body',
        kind: 'text' as const,
        label: 'Slide body',
        value: 'Water moves across a membrane. Solutes stay put.',
      },
    ],
    ...overrides,
  })

  it('describes both layouts, the holes, and the orphaned content', async () => {
    fetchMock.mockResolvedValue(geminiReply({ slots: { bullets: ['A'] } }))

    await provider.refitSlideLayout(refitRequest())

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body))
    const prompt = body.contents[0].parts[0].text as string
    expect(prompt).toContain('Boxes to fill')
    expect(prompt).toContain(
      '"bullets" (Slide bullets; bullets, styled bullet; max 2 items)',
    )
    expect(prompt).toContain('Water moves across a membrane')
    // The instruction that protects the boxes which carried over intact
    expect(prompt).toContain('Do NOT rewrite those')
  })

  it('keeps only the boxes it was asked to fill', async () => {
    // A model that also answers for `title` would overwrite content the
    // switch carried across untouched — the one thing this pass must not do.
    fetchMock.mockResolvedValue(
      geminiReply({ slots: { bullets: ['A', 'B'], title: 'Sneaky' } }),
    )

    const result = await provider.refitSlideLayout(refitRequest())

    expect(result.slots).toEqual({ bullets: ['A', 'B'] })
  })

  it('trims a bullet box to the items it declares room for', async () => {
    fetchMock.mockResolvedValue(
      geminiReply({ slots: { bullets: ['A', 'B', 'C', 'D'] } }),
    )

    const result = await provider.refitSlideLayout(refitRequest())

    expect(result.slots.bullets).toEqual(['A', 'B'])
  })

  it('coerces a string reply for a bullet box into one item', async () => {
    fetchMock.mockResolvedValue(geminiReply({ slots: { bullets: 'Just one' } }))

    const result = await provider.refitSlideLayout(refitRequest())

    expect(result.slots.bullets).toEqual(['Just one'])
  })

  it('drops empty answers rather than writing blank boxes', async () => {
    fetchMock.mockResolvedValue(geminiReply({ slots: { bullets: ['', '  '] } }))

    const result = await provider.refitSlideLayout(refitRequest())

    expect(result.slots).toEqual({})
  })

  it('fills nothing when the reply is unusable', async () => {
    fetchMock.mockResolvedValue(geminiReply({ nonsense: true }))

    expect((await provider.refitSlideLayout(refitRequest())).slots).toEqual({})
  })

  it('still raises a quota failure, which is not a content problem', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'quota',
      json: async () => ({}),
    })

    await expect(
      provider.refitSlideLayout(refitRequest()),
    ).rejects.toBeInstanceOf(GenerationUnavailableError)
  })
})

describe('pingGemini', () => {
  it('reports disabled when no API key is configured', async () => {
    testEnv.GEMINI_API_KEY = undefined
    const result = await pingGemini()
    expect(result).toEqual({ status: 'disabled', detail: 'not configured' })
    // A disabled provider must not make a network call.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports ok when the models endpoint responds 200', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    const result = await pingGemini()
    expect(result).toEqual({ status: 'ok', detail: 'connected' })
    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).toMatch(/\/models$/)
  })

  it('reports auth failure on 401/403', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 })
    expect(await pingGemini()).toEqual({
      status: 'down',
      detail: 'auth failed',
    })
  })

  it('reports down with the status code on other errors', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    expect(await pingGemini()).toEqual({ status: 'down', detail: 'HTTP 500' })
  })

  it('reports down when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    expect((await pingGemini()).status).toBe('down')
  })
})

describe('a code box answered in prose is asked again (GEN-11)', () => {
  const codeLayout = [
    {
      type: 'content',
      label: 'Content',
      purpose: 'x',
      slots: [
        { name: 'title', kind: 'text', label: 'Title' },
        {
          name: 'snippet',
          kind: 'code',
          label: 'Slide body',
          options: { language: 'python' },
        },
      ],
    },
  ]

  const request = () =>
    ({
      phrase: 'a while loop that counts down from ten',
      rollingContext: [],
      layoutDescriptors: codeLayout,
    }) as never

  it('retries, and keeps what the second answer gives', async () => {
    // An empty box on a lecture slide helps nobody; the model usually complies
    // when the demand is the only thing in front of it
    const replies = [
      {
        action: 'new',
        layoutType: 'content',
        slots: {
          title: 'While loops',
          snippet: 'A while loop continues as long as n is greater than 10.',
        },
      },
      { snippet: 'while n > 10:\n    n -= 1' },
    ]
    fetchMock.mockImplementation(async () => geminiReply(replies.shift()))

    const result = await new GeminiGenerationProvider().generateSlideContent(
      request(),
    )
    expect(result.declared?.snippet).toEqual({
      kind: 'code',
      source: 'while n > 10:\n    n -= 1',
      language: 'python',
    })
  })

  it('asks only for the box it refused, not for the slide again', async () => {
    const prompts: string[] = []
    const replies = [
      {
        action: 'new',
        layoutType: 'content',
        slots: { title: 'While loops', snippet: 'This shows a loop.' },
      },
      { snippet: 'print(1)' },
    ]
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      prompts.push(String(init?.body))
      return geminiReply(replies.shift())
    })

    await new GeminiGenerationProvider().generateSlideContent(request())
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('snippet')
    expect(prompts[1]).toContain('python')
    // It must know WHAT the slide is about — a retry with no topic writes
    // something generic and correct-looking, which is how a lecture about
    // while loops got a hello-world function
    expect(prompts[1]).toContain('a while loop that counts down from ten')
    expect(prompts[1]).toContain('While loops')
    // The prose it wrongly returned is the best brief available
    expect(prompts[1]).toContain('This shows a loop.')
    // Knowing the topic is not permission to change the slide
    expect(prompts[1]).toContain('Do not change the')
  })

  it('leaves the box empty when the second answer is prose too', async () => {
    const replies = [
      {
        action: 'new',
        layoutType: 'content',
        slots: { title: 'While loops', snippet: 'This shows a loop.' },
      },
      { snippet: 'It repeats until the condition is false.' },
    ]
    fetchMock.mockImplementation(async () => geminiReply(replies.shift()))

    const result = await new GeminiGenerationProvider().generateSlideContent(
      request(),
    )
    expect(result.declared?.snippet).toBeUndefined()
    expect(result.slots.title).toBe('While loops')
  })

  it('does not retry a box the model filled correctly', async () => {
    let calls = 0
    fetchMock.mockImplementation(async () => {
      calls++
      return geminiReply({
        action: 'new',
        layoutType: 'content',
        slots: { title: 'While loops', snippet: 'while n > 10:\n    n -= 1' },
      })
    })

    await new GeminiGenerationProvider().generateSlideContent(request())
    expect(calls).toBe(1)
  })
})
