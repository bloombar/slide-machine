/**
 * Unit tests for the slide renderer: each layout arranges its slots,
 * image slots show the GEN-5 skeleton until enrichment exists.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
  it('renders unknown layout types through the generic fallback', () => {
    render(
      <SlideView
        slide={slide({
          // A layout this client has no renderer for (e.g. a future
          // user-authored type) must degrade, never disappear
          layoutType: 'timeline' as never,
          title: 'Milestones',
          body: 'From seed to harvest',
        })}
        template={template}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Milestones' }),
    ).toBeInTheDocument()
    expect(screen.getByText('From seed to harvest')).toBeInTheDocument()
    expect(screen.getByTestId('slide')).toHaveAttribute(
      'data-layout',
      'timeline',
    )
  })

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

  it('pulses the image skeleton while enrichment is pending', () => {
    render(
      <SlideView
        slide={slide({ layoutType: 'two-column', title: 'T', body: 'B' })}
        template={template}
        imagePending
      />,
    )
    expect(screen.getByTestId('image-skeleton')).toBeInTheDocument()
  })

  it('shows a quiet static fallback when no image is pending or found', () => {
    render(
      <SlideView
        slide={slide({ layoutType: 'two-column', title: 'T', body: 'B' })}
        template={template}
      />,
    )
    expect(screen.getByTestId('image-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('image-skeleton')).not.toBeInTheDocument()
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

describe('SlideView in-place editing', () => {
  it('lets owners edit the title in place, emitting a patch', () => {
    const onEdit = vi.fn()
    render(
      <SlideView
        slide={slide({ layoutType: 'title', title: 'Photosynthesis' })}
        template={template}
        editable
        onEdit={onEdit}
      />,
    )

    fireEvent.click(screen.getByTitle('Click to edit Slide title'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Slide title' }), {
      target: { value: 'Photosynthesis 101' },
    })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(onEdit).toHaveBeenCalledWith({ title: 'Photosynthesis 101' })
  })

  it('edits the bullet list as a whole, one line per bullet', () => {
    const onEdit = vi.fn()
    render(
      <SlideView
        slide={slide({
          layoutType: 'list',
          title: 'Needs',
          bullets: ['sun', 'water'],
        })}
        template={template}
        editable
        onEdit={onEdit}
      />,
    )

    fireEvent.click(screen.getByTitle('Click to edit Slide bullets'))
    const box = screen.getByRole('textbox', { name: 'Slide bullets' })
    expect(box).toHaveValue('sun\nwater')
    fireEvent.change(box, {
      target: { value: 'sun\nfresh water\nsoil\n' },
    })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })

    expect(onEdit).toHaveBeenCalledWith({
      bullets: ['sun', 'fresh water', 'soil'],
    })
  })

  it('renders plain text when not editable', () => {
    render(
      <SlideView
        slide={slide({ layoutType: 'title', title: 'Photosynthesis' })}
        template={template}
      />,
    )
    expect(
      screen.queryByTitle('Click to edit Slide title'),
    ).not.toBeInTheDocument()
  })

  it('shows empty conditional slots as clickable placeholders for editors', () => {
    const onEdit = vi.fn()
    render(
      <SlideView
        // Title layout hides its caption when empty — editors still
        // need a way in after a layout switch strands the slot
        slide={slide({ layoutType: 'title', title: 'Photosynthesis' })}
        template={template}
        editable
        onEdit={onEdit}
      />,
    )

    // The placeholder is invisible to the audience (transparent text,
    // skeleton on hover/reveal — index.css) but stays clickable
    expect(screen.getByText('Add slide caption')).toHaveClass('slot-blank')

    fireEvent.click(screen.getByText('Add slide caption'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Slide caption' }), {
      target: { value: 'An overview' },
    })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(onEdit).toHaveBeenCalledWith({ caption: 'An overview' })
  })

  it('keeps empty conditional slots hidden from viewers', () => {
    render(
      <SlideView
        slide={slide({ layoutType: 'title', title: 'Photosynthesis' })}
        template={template}
      />,
    )
    expect(screen.queryByText('Add slide caption')).not.toBeInTheDocument()
  })
})

describe('SlideView layout-flip slot tagging (GEN-9)', () => {
  it('tags every text slot with a permanent flow-neutral wrapper', () => {
    render(
      <SlideView
        slide={slide({ layoutType: 'content', title: 'Cells', body: 'Units' })}
        template={template}
      />,
    )
    // The wrapper is always present (no remount when a transition starts)
    // and stays inline-block so it never disturbs the layout around it.
    const title = screen.getByRole('heading', { name: 'Cells' })
      .firstElementChild as HTMLElement
    expect(title.tagName).toBe('SPAN')
    expect(title).toHaveClass('inline-block')
    expect(title).not.toHaveClass('h-full')
    expect(title.dataset.flipSlot).toBe('title')
    // The flip id is slide-scoped so a multi-slide list view never
    // matches slots across different slides.
    expect(title.dataset.flipId).toBe('s1:title')
  })

  it('keeps the full-size wrapper for image slots, which fill their frame', () => {
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
    // The image chain relies on h-full/w-full down from the layout's sized
    // container, so its wrapper must pass the size through.
    let wrapper: HTMLElement | null = screen.getByRole('img')
    while (wrapper && wrapper.dataset.flipSlot !== 'image')
      wrapper = wrapper.parentElement
    expect(wrapper?.dataset.flipId).toBe('s1:image')
    expect(wrapper).toHaveClass('h-full', 'w-full')
  })
})

describe('SlideView markdown rendering', () => {
  it('renders inline markdown in the title for viewers', () => {
    render(
      <SlideView
        slide={slide({ layoutType: 'title', title: 'The **Krebs** cycle' })}
        template={template}
      />,
    )
    expect(screen.getByText('Krebs').tagName).toBe('STRONG')
  })

  it('renders list markdown inside the body slot', () => {
    render(
      <SlideView
        slide={slide({
          layoutType: 'content',
          title: 'Steps',
          body: '- glycolysis\n- oxidation',
        })}
        template={template}
      />,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows formatted markdown in editable display, raw source when editing', () => {
    const onEdit = vi.fn()
    render(
      <SlideView
        slide={slide({ layoutType: 'title', title: 'The **Krebs** cycle' })}
        template={template}
        editable
        onEdit={onEdit}
      />,
    )
    expect(screen.getByText('Krebs').tagName).toBe('STRONG')

    fireEvent.click(screen.getByTitle('Click to edit Slide title'))
    expect(screen.getByRole('textbox', { name: 'Slide title' })).toHaveValue(
      'The **Krebs** cycle',
    )
  })
})
