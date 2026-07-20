/**
 * Unit tests for the WAV wrapper: canonical 44-byte header fields, correct
 * little-endian sizes/rates, payload passthrough, and duration math.
 */
import { describe, it, expect } from 'vitest'
import { pcmToWav, pcmDurationMs } from './wav'

describe('pcmToWav', () => {
  it('prepends a canonical 44-byte LINEAR16 mono header', () => {
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) // 8 bytes = 4 samples
    const wav = pcmToWav(pcm, 16_000)

    expect(wav.length).toBe(44 + pcm.length)
    // RIFF / WAVE / fmt / data markers
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.toString('ascii', 36, 40)).toBe('data')

    // Sizes and format fields
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length) // RIFF chunk size
    expect(wav.readUInt32LE(16)).toBe(16) // PCM fmt size
    expect(wav.readUInt16LE(20)).toBe(1) // format = PCM
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(16_000) // sample rate
    expect(wav.readUInt32LE(28)).toBe(32_000) // byte rate = rate * 2
    expect(wav.readUInt16LE(32)).toBe(2) // block align
    expect(wav.readUInt16LE(34)).toBe(16) // bits per sample
    expect(wav.readUInt32LE(40)).toBe(pcm.length) // data size

    // Payload is appended verbatim
    expect(wav.subarray(44)).toEqual(pcm)
  })

  it('reflects a different sample rate in header and byte rate', () => {
    const wav = pcmToWav(Buffer.alloc(4), 48_000)
    expect(wav.readUInt32LE(24)).toBe(48_000)
    expect(wav.readUInt32LE(28)).toBe(96_000)
  })
})

describe('pcmDurationMs', () => {
  it('computes ms from byte length at the sample rate', () => {
    // 32000 bytes = 16000 samples at 16kHz mono (2 bytes/sample) = 1000 ms
    expect(pcmDurationMs(Buffer.alloc(32_000), 16_000)).toBe(1000)
    // 16000 bytes at 16kHz = 0.5s
    expect(pcmDurationMs(Buffer.alloc(16_000), 16_000)).toBe(500)
  })

  it('is zero for an unknown sample rate', () => {
    expect(pcmDurationMs(Buffer.alloc(100), 0)).toBe(0)
  })
})
