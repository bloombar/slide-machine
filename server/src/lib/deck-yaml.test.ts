/**
 * Unit tests for the deck YAML serializer (EXP-2): the exported document
 * captures structure, content, and image attribution, omits absent fields, and
 * parses back cleanly (round-trip friendly, EXP-3).
 */
import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
import { deckToYaml, DECK_YAML_VERSION, type ExportDeck } from './deck-yaml'

const deck: ExportDeck = {
  title: 'Photosynthesis',
  templateId: 'classic',
  visibility: 'restricted',
  slides: [
    { layoutType: 'title', title: 'Photosynthesis', body: 'An overview' },
    {
      layoutType: 'bullets',
      title: 'Where it happens',
      bullets: ['In chloroplasts', 'Using chlorophyll'],
      imageRef: 'https://img/leaf.jpg',
      caption: 'A green leaf',
      attribution: {
        title: 'Leaf',
        creator: 'Ada',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      },
    },
  ],
}

describe('deckToYaml', () => {
  it('emits a versioned deck document that parses back to the content', () => {
    const yaml = deckToYaml(deck)
    const parsed = YAML.parse(yaml)
    expect(parsed.version).toBe(DECK_YAML_VERSION)
    expect(parsed.kind).toBe('deck')
    expect(parsed.title).toBe('Photosynthesis')
    expect(parsed.templateId).toBe('classic')
    expect(parsed.visibility).toBe('restricted')
    expect(parsed.slides).toHaveLength(2)
  })

  it('serializes a slide with its layout, bullets, image, and attribution', () => {
    const parsed = YAML.parse(deckToYaml(deck))
    const slide = parsed.slides[1]
    expect(slide.layout).toBe('bullets')
    expect(slide.title).toBe('Where it happens')
    expect(slide.bullets).toEqual(['In chloroplasts', 'Using chlorophyll'])
    expect(slide.image.ref).toBe('https://img/leaf.jpg')
    expect(slide.image.caption).toBe('A green leaf')
    expect(slide.image.attribution).toMatchObject({
      title: 'Leaf',
      creator: 'Ada',
      license: 'CC BY-SA 4.0',
    })
  })

  it('omits absent fields rather than writing empty keys', () => {
    const parsed = YAML.parse(deckToYaml(deck))
    const titleSlide = parsed.slides[0]
    // No image on the first slide, so no image block at all.
    expect(titleSlide.image).toBeUndefined()
    expect(titleSlide.bullets).toBeUndefined()
  })

  it('drops an empty attribution object entirely', () => {
    const yaml = deckToYaml({
      title: 'T',
      templateId: 'c',
      slides: [
        { layoutType: 'image', imageRef: 'https://img/x.jpg', attribution: {} },
      ],
    })
    const slide = YAML.parse(yaml).slides[0]
    expect(slide.image.ref).toBe('https://img/x.jpg')
    expect(slide.image.attribution).toBeUndefined()
  })

  it('omits an optional visibility when the deck has none', () => {
    const parsed = YAML.parse(
      deckToYaml({ title: 'T', templateId: 'c', slides: [] }),
    )
    expect(parsed.visibility).toBeUndefined()
    expect(parsed.slides).toEqual([])
  })

  it('carries General-tab settings for round-trip import (EXP-3)', () => {
    const parsed = YAML.parse(
      deckToYaml({
        title: 'T',
        templateId: 'classic',
        settings: {
          language: 'fr',
          generationFreedom: 4,
          ttsVoice: 'emma',
        },
        slides: [],
      }),
    )
    expect(parsed.settings).toEqual({
      language: 'fr',
      generationFreedom: 4,
      ttsVoice: 'emma',
    })
  })

  it('omits the settings block entirely when nothing is set', () => {
    const parsed = YAML.parse(
      deckToYaml({ title: 'T', templateId: 'c', settings: {}, slides: [] }),
    )
    expect(parsed.settings).toBeUndefined()
  })

  it('does not carry seed notes or seed material (privacy)', () => {
    const parsed = YAML.parse(
      deckToYaml({
        title: 'T',
        templateId: 'classic',
        settings: { language: 'fr' },
        slides: [],
      }),
    )
    // Neither the private seed notes nor any seed-material block is emitted.
    expect(parsed.settings.seedNotes).toBeUndefined()
    expect(parsed.seedMaterial).toBeUndefined()
  })
})
