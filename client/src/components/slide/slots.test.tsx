/**
 * Unit tests for the slot system: the registry mounts the right editor
 * for each media kind, descriptors drive labels, and every editor
 * produces a patch keyed by its slide field.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { LayoutSlot, Slide } from '@slide-machine/shared'
import SlideSlot from './slots'
import { searchSlideImages } from '../../api/slides'
import type { ThemeColors } from './theme'

// The replace dialog searches on open; keep it offline in slot tests.
vi.mock('../../api/slides', () => ({
  searchSlideImages: vi.fn(() => Promise.resolve([])),
}))
const mockedSearch = vi.mocked(searchSlideImages)

const colors: ThemeColors = {
  background: '#000',
  surface: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#0ff',
  penColor: '#000',
  highlighterColor: '#ff0',
}

const slide = (overrides: Partial<Slide>): Slide => ({
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'content',
  ...overrides,
})

describe('SlideSlot', () => {
  it('renders text slots read-only without an edit handler', () => {
    render(
      <SlideSlot
        slot="title"
        slide={slide({ title: 'Osmosis' })}
        colors={colors}
      />,
    )
    expect(screen.getByText('Osmosis')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('mounts an editor labeled by the slot descriptor and patches its field', () => {
    vi.useFakeTimers()
    const onEdit = vi.fn()
    render(
      <SlideSlot
        slot="caption"
        slide={slide({ caption: 'A cell' })}
        colors={colors}
        onEdit={onEdit}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide caption'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Slide caption' }), {
      target: { value: 'A plant cell' },
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Slide caption' }), {
      key: 'Enter',
    })
    vi.runAllTimers()
    expect(onEdit).toHaveBeenCalledWith({ caption: 'A plant cell' })
    vi.useRealTimers()
  })

  it('edits bullets as a whole and patches them as an array', () => {
    vi.useFakeTimers()
    const onEdit = vi.fn()
    render(
      <SlideSlot
        slot="bullets"
        slide={slide({ bullets: ['sun', 'water'] })}
        colors={colors}
        onEdit={onEdit}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide bullets'))
    const box = screen.getByRole('textbox', { name: 'Slide bullets' })
    fireEvent.change(box, { target: { value: 'sun\nwater\nCO2' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    vi.runAllTimers()
    expect(onEdit).toHaveBeenCalledWith({ bullets: ['sun', 'water', 'CO2'] })
    vi.useRealTimers()
  })

  it('keeps image slots reserved: skeleton while pending, quiet block after', () => {
    const { rerender } = render(
      <SlideSlot slot="image" slide={slide({})} colors={colors} imagePending />,
    )
    expect(screen.getByTestId('image-skeleton')).toBeInTheDocument()
    rerender(<SlideSlot slot="image" slide={slide({})} colors={colors} />)
    expect(screen.getByTestId('image-fallback')).toBeInTheDocument()
  })

  const imageEditor = (over: Partial<Slide> = {}) => ({
    slot: 'image' as LayoutSlot,
    slide: slide({ imageRef: 'http://img/x.png', ...over }),
    colors,
    onReplaceImage: vi.fn(),
    onPickImageCandidate: vi.fn(),
    onRemoveImage: vi.fn(),
  })

  it('gives owners Replace and Remove buttons over an image', () => {
    render(<SlideSlot {...imageEditor()} />)
    expect(
      screen.getByRole('button', { name: 'Replace image' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove image' }),
    ).toBeInTheDocument()
  })

  it('opens the replace dialog from the Replace control', async () => {
    render(<SlideSlot {...imageEditor()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Replace image' }))
    expect(
      await screen.findByRole('dialog', { name: 'Replace image' }),
    ).toBeInTheDocument()
  })

  it('uploads a picked file from the replace dialog', async () => {
    const props = imageEditor()
    render(<SlideSlot {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Replace image' }))
    const file = new File(['x'], 'new.png', { type: 'image/png' })
    fireEvent.change(await screen.findByLabelText('Upload image file'), {
      target: { files: [file] },
    })
    expect(props.onReplaceImage).toHaveBeenCalledWith(file)
  })

  it('uploads a dropped file to replace the image', () => {
    const props = imageEditor()
    const { container } = render(<SlideSlot {...props} />)
    const zone = container.querySelector('.group')!
    const file = new File(['x'], 'drop.png', { type: 'image/png' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(props.onReplaceImage).toHaveBeenCalledWith(file)
  })

  it('asks the page to remove the image', () => {
    const props = imageEditor()
    render(<SlideSlot {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(props.onRemoveImage).toHaveBeenCalled()
  })

  it('opens the same dialog from the Add affordance and uploads', async () => {
    const props = imageEditor({ imageRef: undefined })
    render(<SlideSlot {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add image' }))
    // Empty slot: the dialog is titled "Add image", not "Replace image"
    expect(
      await screen.findByRole('dialog', { name: 'Add image' }),
    ).toBeInTheDocument()
    const file = new File(['x'], 'add.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload image file'), {
      target: { files: [file] },
    })
    expect(props.onReplaceImage).toHaveBeenCalledWith(file)
  })

  it('seeds the search from the primary image keyword, not the "New slide" placeholder', async () => {
    mockedSearch.mockClear()
    render(
      <SlideSlot
        {...imageEditor({
          imageRef: undefined,
          title: 'New slide',
          imageKeywords: ['mitochondria', 'cell'],
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add image' }))
    await screen.findByRole('dialog', { name: 'Add image' })
    // The keywords seed the box as a COMMA-separated list — each phrase is
    // searched and pooled, never space-joined into one conjunctive query.
    expect(mockedSearch).toHaveBeenCalledWith('s1', 'mitochondria, cell')
  })

  it('starts the search blank on a fresh "New slide" with no keywords', async () => {
    mockedSearch.mockClear()
    render(
      <SlideSlot
        {...imageEditor({ imageRef: undefined, title: 'New slide' })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add image' }))
    await screen.findByRole('dialog', { name: 'Add image' })
    expect(mockedSearch).toHaveBeenCalledWith('s1', '')
  })

  it('highlights the slot while a file is dragged over it', () => {
    const { container } = render(<SlideSlot {...imageEditor()} />)
    const zone = container.querySelector('.group')!
    fireEvent.dragOver(zone)
    // A dashed highlight overlay appears
    expect(container.querySelector('.border-dashed')).toBeInTheDocument()
    fireEvent.dragLeave(zone)
    expect(container.querySelector('.border-dashed')).not.toBeInTheDocument()
  })

  it('falls back to the Add affordance when the image fails to load', () => {
    render(<SlideSlot {...imageEditor()} />)
    fireEvent.error(screen.getByRole('img'))
    expect(
      screen.getByRole('button', { name: 'Add image' }),
    ).toBeInTheDocument()
  })

  it('ignores a drop with no file', () => {
    const props = imageEditor()
    const { container } = render(<SlideSlot {...props} />)
    const zone = container.querySelector('.group')!
    fireEvent.drop(zone, { dataTransfer: { files: [] } })
    expect(props.onReplaceImage).not.toHaveBeenCalled()
  })

  it('gives owners only an Add control over an empty image slot', () => {
    render(<SlideSlot {...imageEditor({ imageRef: undefined })} />)
    expect(
      screen.getByRole('button', { name: 'Add image' }),
    ).toBeInTheDocument()
    // No Remove on an empty slot: removing keeps the layout and just empties
    // the slot, so there is nothing to remove once it is already empty.
    expect(
      screen.queryByRole('button', { name: 'Remove image' }),
    ).not.toBeInTheDocument()
  })

  it('offers Add to an owner even while enrichment is pending', () => {
    // Waiting on an image that may never arrive must not block adding one;
    // the reserved block pulses as the pending skeleton meanwhile
    render(<SlideSlot {...imageEditor({ imageRef: undefined })} imagePending />)
    expect(
      screen.getByRole('button', { name: 'Add image' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('image-skeleton')).toBeInTheDocument()
  })

  it('still shows read-only viewers the pending skeleton', () => {
    render(
      <SlideSlot slot="image" slide={slide({})} colors={colors} imagePending />,
    )
    expect(screen.getByTestId('image-skeleton')).toBeInTheDocument()
  })

  const attributed = { creator: 'Ada', license: 'CC BY 4.0' }

  it('shows the "i" icon to a viewer only when credit exists', () => {
    const { rerender } = render(
      <SlideSlot
        slot="image"
        slide={slide({ imageRef: 'http://img/x.png' })}
        colors={colors}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Image details' }),
    ).not.toBeInTheDocument()

    rerender(
      <SlideSlot
        slot="image"
        slide={slide({ imageRef: 'http://img/x.png', attribution: attributed })}
        colors={colors}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Image details' }),
    ).toBeInTheDocument()
  })

  it('always gives owners the "i" icon so they can add credit', () => {
    render(<SlideSlot {...imageEditor()} onEdit={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Image details' }))
    expect(
      screen.getByRole('dialog', { name: 'Image details' }),
    ).toBeInTheDocument()
  })

  it('saves edited attribution through onEdit', () => {
    const onEdit = vi.fn()
    render(<SlideSlot {...imageEditor()} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Image details' }))
    fireEvent.change(screen.getByLabelText('Credit'), {
      target: { value: 'Grace' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onEdit).toHaveBeenCalledWith({
      attribution: {
        sourceUrl: undefined,
        creator: 'Grace',
        license: undefined,
      },
    })
  })

  it('labels the image buttons on hover', () => {
    render(<SlideSlot {...imageEditor()} onEdit={vi.fn()} />)
    expect(screen.getByText('Replace image')).toBeInTheDocument()
    expect(screen.getByText('Delete image')).toBeInTheDocument()
    expect(screen.getByText('Image details')).toBeInTheDocument()
  })

  it('makes AI-sourced attribution read-only, even for the owner', () => {
    render(
      <SlideSlot
        {...imageEditor({
          imageSource: 'stock',
          attribution: { creator: 'Jane', license: 'CC BY 4.0' },
        })}
        onEdit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Image details' }))
    // The credit is shown but cannot be edited
    expect(screen.getByText('Jane')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()
  })

  it('keeps an edit form for the owner on a seeded (uploaded) image', () => {
    render(
      <SlideSlot
        {...imageEditor({
          imageSource: 'seeded',
          attribution: { creator: 'Me' },
        })}
        onEdit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Image details' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('shows a viewer the recorded credit read-only', () => {
    render(
      <SlideSlot
        slot="image"
        slide={slide({ imageRef: 'http://img/x.png', attribution: attributed })}
        colors={colors}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Image details' }))
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('CC BY 4.0')).toBeInTheDocument()
    // Read-only: no save button
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()
  })

  it('shows no image controls to read-only viewers', () => {
    render(
      <SlideSlot
        slot="image"
        slide={slide({ imageRef: 'http://img/x.png' })}
        colors={colors}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Remove image' }),
    ).not.toBeInTheDocument()
  })

  it("lets the template's slot spec override the conventional defaults", () => {
    render(
      <SlideSlot
        slot="title"
        spec={{ name: 'title', kind: 'text', label: 'Headline' }}
        slide={slide({ title: 'Osmosis' })}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    // The template-declared label reaches the editor affordances
    expect(screen.getByTitle('Click to edit Headline')).toBeInTheDocument()
  })

  it('renders nothing for a slot without a descriptor', () => {
    const { container } = render(
      <SlideSlot
        slot={'hologram' as LayoutSlot}
        slide={slide({})}
        colors={colors}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
