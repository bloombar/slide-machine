/**
 * Unit tests for the slide renderer: each layout arranges its slots,
 * image slots show the GEN-5 skeleton until enrichment exists.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Slide, Template } from '@slide-machine/shared'
import SlideView from './SlideView'

const template: Template = {
  id: 'test',
  ownerId: 'system',
  name: 'Test',
  theme: {
    background: '#000',
    text: '#fff',
    accent: '#0ff',
    muted: '#888',
    surface: '#111',
  },
  layouts: [],
  visibility: 'public',
  voteScore: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
}

const slide = (overrides: Partial<Slide>): Slide => ({
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'content',
  ...overrides,
})

describe('SlideView', () => {
  it('renders a title layout', () => {
    render(
      <SlideView
        slide={slide({ layoutType: 'title', title: 'Photosynthesis' })}
        template={template}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Photosynthesis' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('slide')).toHaveAttribute('data-layout', 'title')
  })

  it('renders a list layout with bullets', () => {
    render(
      <SlideView
        slide={slide({
          layoutType: 'list',
          title: 'Needs',
          bullets: ['sun', 'water', 'CO2'],
        })}
        template={template}
      />,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('renders a quote layout from the body', () => {
    render(
      <SlideView
        slide={slide({ layoutType: 'quote', body: 'What happens at night?' })}
        template={template}
      />,
    )
    expect(screen.getByText(/What happens at night\?/)).toBeInTheDocument()
  })

  it('shows an image skeleton in image slots until enrichment exists', () => {
    render(
      <SlideView
        slide={slide({ layoutType: 'two-column', title: 'T', body: 'B' })}
        template={template}
      />,
    )
    expect(screen.getByTestId('image-skeleton')).toBeInTheDocument()
  })

  it('renders a real image when the slide has one', () => {
    render(
      <SlideView
        slide={slide({
          layoutType: 'image-heavy',
          imageRef: 'http://img/x.jpg',
          caption: 'A cell',
        })}
        template={template}
      />,
    )
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://img/x.jpg')
    expect(screen.queryByTestId('image-skeleton')).not.toBeInTheDocument()
  })
})
