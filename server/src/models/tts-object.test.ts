/**
 * Unit tests for the narration cache's key derivation. The route hashes what
 * was spoken and stores audio plus a marks sidecar under it; the reference
 * index has to name the same two keys to be able to delete them later, so both
 * come from here rather than being spelled out twice.
 */
import { describe, it, expect } from 'vitest'
import { ttsStorageKeys } from './tts-object'

describe('ttsStorageKeys', () => {
  it('puts audio and its sidecar under the tts/ prefix', () => {
    expect(ttsStorageKeys('abc123', 'mp3')).toEqual({
      storageKey: 'tts/abc123.mp3',
      marksKey: 'tts/abc123.json',
    })
  })

  it('keeps the sidecar JSON whatever the audio format', () => {
    expect(ttsStorageKeys('abc123', 'wav').marksKey).toBe('tts/abc123.json')
  })

  it('separates entries by hash', () => {
    const a = ttsStorageKeys('one', 'mp3')
    const b = ttsStorageKeys('two', 'mp3')
    expect(a.storageKey).not.toBe(b.storageKey)
    expect(a.marksKey).not.toBe(b.marksKey)
  })

  it('stays inside the prefix a lifecycle rule can be scoped to', () => {
    const { storageKey, marksKey } = ttsStorageKeys('deadbeef', 'wav')
    expect(storageKey.startsWith('tts/')).toBe(true)
    expect(marksKey.startsWith('tts/')).toBe(true)
  })
})
