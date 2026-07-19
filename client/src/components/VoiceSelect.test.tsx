/** Unit tests for the narration voice picker: options, inherit, and change. */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TTS_VOICES } from '@slide-machine/shared'
import VoiceSelect from './VoiceSelect'

describe('VoiceSelect', () => {
  it('lists the catalog voices plus an inherit default', () => {
    render(<VoiceSelect defaultLabel="system default" onChange={vi.fn()} />)
    const select = screen.getByLabelText('Narration voice') as HTMLSelectElement
    expect(select.value).toBe('') // undefined value → inherit
    expect(
      screen.getByRole('option', { name: 'Default — system default' }),
    ).toBeInTheDocument()
    for (const v of TTS_VOICES) {
      expect(screen.getByRole('option', { name: v.label })).toBeInTheDocument()
    }
  })

  it('reports the chosen voice id, and null when cleared to default', () => {
    const onChange = vi.fn()
    render(
      <VoiceSelect
        value={TTS_VOICES[0]!.id}
        defaultLabel="Project setting"
        onChange={onChange}
      />,
    )
    const select = screen.getByLabelText('Narration voice')
    fireEvent.change(select, { target: { value: TTS_VOICES[1]!.id } })
    expect(onChange).toHaveBeenCalledWith(TTS_VOICES[1]!.id)
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
