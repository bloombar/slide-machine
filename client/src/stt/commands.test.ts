/**
 * Unit tests for the voice-command vocabulary: wake word required,
 * whole-phrase synonym matching, normalization, and lecture speech
 * passing through untouched.
 */
import { describe, it, expect } from 'vitest'
import { matchVoiceCommand } from './commands'

describe('matchVoiceCommand', () => {
  it('matches wake-worded commands across synonyms and punctuation', () => {
    expect(matchVoiceCommand('Slide machine, next slide')).toBe('next')
    expect(matchVoiceCommand('slide machine forward')).toBe('next')
    expect(matchVoiceCommand('SLIDE MACHINE: go back!')).toBe('previous')
    expect(matchVoiceCommand('slide machine rewind')).toBe('previous')
    expect(matchVoiceCommand('slide machine, pause.')).toBe('pause')
    expect(matchVoiceCommand('slide machine stop listening')).toBe('pause')
    expect(matchVoiceCommand('slide machine new slide')).toBe('newSlide')
    expect(matchVoiceCommand('slide machine, add a slide')).toBe('newSlide')
    expect(matchVoiceCommand('slide machine, new whiteboard')).toBe(
      'newWhiteboardSlide',
    )
    expect(matchVoiceCommand('slide machine new chalkboard')).toBe(
      'newWhiteboardSlide',
    )
  })

  it('requires the wake word — commands without it are lecture content', () => {
    expect(matchVoiceCommand('next slide')).toBeNull()
    expect(matchVoiceCommand('go back')).toBeNull()
    expect(matchVoiceCommand('pause')).toBeNull()
  })

  it('requires the remainder to be exactly a known command', () => {
    expect(
      matchVoiceCommand('slide machine, the next slide covers osmosis'),
    ).toBeNull()
    expect(matchVoiceCommand('slide machine')).toBeNull()
    expect(matchVoiceCommand('slide machines are great')).toBeNull()
  })
})
