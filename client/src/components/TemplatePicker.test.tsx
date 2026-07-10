/**
 * Unit tests for the template picker: selection state and callback.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Template } from '@slide-machine/shared'
import TemplatePicker from './TemplatePicker'

const template = (id: string, name: string): Template => ({
  id,
  ownerId: 'system',
  name,
  theme: { background: '#000', accent: '#0ff' },
  layouts: [],
  visibility: 'public',
  voteScore: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
})

const templates = [
  template('classic', 'Classic'),
  template('midnight', 'Midnight'),
]

describe('TemplatePicker', () => {
  it('marks the selected template checked', () => {
    render(
      <TemplatePicker
        templates={templates}
        value="midnight"
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('radio', { name: /midnight/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: /classic/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('reports selection changes', () => {
    const onChange = vi.fn()
    render(
      <TemplatePicker
        templates={templates}
        value="classic"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: /midnight/i }))
    expect(onChange).toHaveBeenCalledWith('midnight')
  })
})
