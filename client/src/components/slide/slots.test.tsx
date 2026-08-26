/**
 * Unit tests for the slot system: the registry mounts the right editor
 * for each media kind, descriptors drive labels, and every editor
 * produces a patch keyed by its slide field.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  createEvent,
} from '@testing-library/react'
import type { LayoutSlot, Slide } from '@slide-machine/shared'
import SlideSlot from './slots'
import { searchSlideImages } from '../../api/slides'
import type { ThemeColors } from './theme'

// The replace dialog searches on open; keep it offline in slot tests.
vi.mock('../../api/slides', () => ({
  searchSlideImages: vi.fn(() => Promise.resolve([])),
}))

// The typesetter and the sixteen grammars are large modules, and this is the
// biggest test file in the suite — loading them here makes every other test in
// it wait. They are exercised for real in MathTypeset.test.tsx and
// CodeHighlighted.test.tsx; what matters here is that the right editor mounts
// and saves the right shape.
vi.mock('./MathTypeset', () => ({
  default: ({ tex }: { tex: string }) => (
    <span data-testid="typeset">{tex}</span>
  ),
}))
vi.mock('./CodeHighlighted', () => ({
  default: ({ source, language }: { source: string; language?: string }) => (
    <pre data-language={language}>
      <code>{source}</code>
    </pre>
  ),
}))
const mockedSearch = vi.mocked(searchSlideImages)

const colors: ThemeColors = {
  background: '#000',
  surface: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#0ff',
  imageBackground: 'transparent',
  penColor: '#000',
  highlighterColor: '#ff0',
  link: '#0ff',
}

const slide = (overrides: Partial<Slide>): Slide => ({
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'content',
  slots: {},
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

  describe('an unfilled picture box', () => {
    const emptyImage = slide({ layoutType: 'image-heavy' })

    it('draws nothing in a lecture, where a reserved block would read as a failure', () => {
      const { container } = render(
        <SlideSlot slot="image" slide={emptyImage} colors={colors} />,
      )
      expect(
        container.querySelector('[data-empty-image-slot]'),
      ).not.toBeInTheDocument()
    })

    it('says it is there when the design is shown AS a design', () => {
      // A template preview claims to show a design, and a design's picture
      // boxes are part of what it is. Left drawing nothing, a template whose
      // pictures are content came out as a page with NOTHING where a dozen
      // pictures belong — which reads as broken rather than as unfilled, and
      // gives an instructor no way to tell the two apart.
      const { container } = render(
        <SlideSlot
          slot="image"
          slide={emptyImage}
          colors={colors}
          asTemplate
        />,
      )
      expect(
        container.querySelector('[data-empty-image-slot]'),
      ).toBeInTheDocument()
    })
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
    expect(onEdit).toHaveBeenCalledWith({
      slots: { caption: { kind: 'text', value: 'A plant cell' } },
    })
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
    expect(onEdit).toHaveBeenCalledWith({
      slots: { bullets: { kind: 'bullets', items: ['sun', 'water', 'CO2'] } },
    })
    vi.useRealTimers()
  })

  /**
   * A link in an editable text box belongs to the link, not to the editor:
   * clicking the words follows it, and clicking anywhere else in the box
   * starts an edit (which is how the link's own text is reached).
   */
  describe('a link inside an editable text box', () => {
    const editableSlot = () =>
      render(
        <SlideSlot
          slot="caption"
          slide={slide({ caption: 'See [the docs](https://example.com)' })}
          colors={colors}
          onEdit={vi.fn()}
        />,
      )

    it('opens the link on a plain click instead of the editor', () => {
      editableSlot()
      const click = createEvent.click(screen.getByRole('link'), {
        bubbles: true,
      })
      fireEvent(screen.getByRole('link'), click)
      expect(click.defaultPrevented).toBe(false)
      expect(
        screen.queryByRole('textbox', { name: 'Slide caption' }),
      ).not.toBeInTheDocument()
    })

    it('still edits the box when the words beside the link are clicked', () => {
      editableSlot()
      fireEvent.click(screen.getByTitle('Click to edit Slide caption'))
      expect(
        screen.getByRole('textbox', { name: 'Slide caption' }),
      ).toHaveValue('See [the docs](https://example.com)')
    })
  })

  it('reserves an image slot while a picture may still arrive', () => {
    render(
      <SlideSlot slot="image" slide={slide({})} colors={colors} imagePending />,
    )
    expect(screen.getByTestId('image-skeleton')).toBeInTheDocument()
  })

  it('shows a viewer nothing where there is no picture', () => {
    // A reserved block reads as a picture that failed to load, and a viewer
    // has no way to put one there
    const { container } = render(
      <SlideSlot slot="image" slide={slide({})} colors={colors} />,
    )
    expect(screen.queryByTestId('image-fallback')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('still gives an editor the block to drop a picture onto', () => {
    render(
      <SlideSlot
        slot="image"
        slide={slide({})}
        colors={colors}
        onReplaceImage={vi.fn()}
        onPickImageCandidate={vi.fn()}
        onRemoveImage={vi.fn()}
      />,
    )
    expect(screen.getByTestId('image-fallback')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add image' }),
    ).toBeInTheDocument()
  })

  const imageEditor = (over: Partial<Slide> = {}) => ({
    slot: 'image' as LayoutSlot,
    slide: slide({ imageRef: 'http://img/x.png', ...over }),
    colors,
    onReplaceImage: vi.fn(),
    onPickImageCandidate: vi.fn(),
    onRemoveImage: vi.fn(),
  })

  // Both directions, because either alone passes trivially: a rule that
  // letterboxed every picture satisfies the first expectation, and the
  // unconditional `cover` this replaced satisfies the second.
  it.each([
    ['stock', 'object-contain', 'object-cover'],
    ['seeded', 'object-contain', 'object-cover'],
    ['generated', 'object-cover', 'object-contain'],
    [undefined, 'object-cover', 'object-contain'],
  ] as const)('shows a %s picture with %s and not %s', (source, fit, not) => {
    const { container } = render(
      <SlideSlot {...imageEditor({ imageSource: source })} />,
    )
    const img = container.querySelector('img')!
    expect(img).toHaveClass(fit)
    expect(img).not.toHaveClass(not)
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
    expect(props.onReplaceImage).toHaveBeenCalledWith(file, 'image')
  })

  it('uploads a dropped file to replace the image', () => {
    const props = imageEditor()
    const { container } = render(<SlideSlot {...props} />)
    const zone = container.querySelector('.group')!
    const file = new File(['x'], 'drop.png', { type: 'image/png' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(props.onReplaceImage).toHaveBeenCalledWith(file, 'image')
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
    expect(props.onReplaceImage).toHaveBeenCalledWith(file, 'image')
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
      slots: {
        image: {
          kind: 'image',
          attribution: {
            sourceUrl: undefined,
            creator: 'Grace',
            license: undefined,
          },
        },
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

/**
 * Slots a template author added themselves (TMPL-4). They have no field of
 * their own on the slide, so their content is keyed by name — and everything
 * else about them behaves exactly like a conventional slot.
 */
describe('a slot the template author defined', () => {
  const photo = { name: 'photo-2', kind: 'image' as const, label: 'Photo 2' }
  const note = { name: 'note', kind: 'text' as const, label: 'Note' }

  it('shows what the slide stored under its name', () => {
    render(
      <SlideSlot
        slot="note"
        spec={note}
        slide={slide({
          slots: { note: { kind: 'text', value: 'Read chapter 4' } },
        })}
        colors={colors}
      />,
    )
    expect(screen.getByText('Read chapter 4')).toBeInTheDocument()
  })

  it('patches by name rather than by slide field', () => {
    vi.useFakeTimers()
    const onEdit = vi.fn()
    render(
      <SlideSlot
        slot="note"
        spec={note}
        slide={slide({
          slots: { note: { kind: 'text', value: 'Read chapter 4' } },
        })}
        colors={colors}
        onEdit={onEdit}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Note'))
    const box = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(box, { target: { value: 'Read chapter 5' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    vi.runAllTimers()
    expect(onEdit).toHaveBeenCalledWith({
      slots: { note: { kind: 'text', value: 'Read chapter 5' } },
    })
    vi.useRealTimers()
  })

  it('draws its own picture, not the slide’s', () => {
    render(
      <SlideSlot
        slot="photo-2"
        spec={photo}
        slide={slide({
          imageRef: 'http://img/first.png',
          slots: {
            'photo-2': { kind: 'image', ref: 'http://img/second.png' },
          },
        })}
        colors={colors}
      />,
    )
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'http://img/second.png',
    )
  })

  it('uploads into the box that was dropped on', () => {
    const onReplaceImage = vi.fn()
    const { container } = render(
      <SlideSlot
        slot="photo-2"
        spec={photo}
        slide={slide({})}
        colors={colors}
        onReplaceImage={onReplaceImage}
        onPickImageCandidate={vi.fn()}
        onRemoveImage={vi.fn()}
      />,
    )
    const file = new File(['x'], 'second.png', { type: 'image/png' })
    fireEvent.drop(container.querySelector('.group')!, {
      dataTransfer: { files: [file] },
    })
    expect(onReplaceImage).toHaveBeenCalledWith(file, 'photo-2')
  })

  it('empties the box that was cleared', () => {
    const onRemoveImage = vi.fn()
    render(
      <SlideSlot
        slot="photo-2"
        spec={photo}
        slide={slide({
          slots: {
            'photo-2': { kind: 'image', ref: 'http://img/second.png' },
          },
        })}
        colors={colors}
        onReplaceImage={vi.fn()}
        onPickImageCandidate={vi.fn()}
        onRemoveImage={onRemoveImage}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(onRemoveImage).toHaveBeenCalledWith('photo-2')
  })

  it('offers Remove on a box the author added, like any other', () => {
    render(
      <SlideSlot
        slot="photo-2"
        spec={photo}
        slide={slide({
          slots: {
            'photo-2': { kind: 'image', ref: 'http://img/second.png' },
          },
        })}
        colors={colors}
        onReplaceImage={vi.fn()}
        onPickImageCandidate={vi.fn()}
        onRemoveImage={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Remove image' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Replace image' }),
    ).toBeInTheDocument()
  })
})

/**
 * The specialized content kinds (TMPL-9), edited in place (EDIT-7).
 *
 * Each is the same bargain as slide text: the slide shows the rendered result,
 * clicking reveals the source. What differs is what "rendered" means, and what
 * must survive the round trip through the editor untouched.
 */
describe('a code slot (EDIT-7)', () => {
  const spec = {
    name: 'example',
    kind: 'code' as const,
    label: 'Worked example',
    options: { language: 'python' },
  }
  const withCode = (source: string) =>
    slide({ slots: { example: { kind: 'code', source } } })

  it('draws it as a listing in the language the template declared', async () => {
    const { container } = render(
      <SlideSlot
        slot="example"
        spec={spec}
        slide={withCode('def f():\n    return 1')}
        colors={colors}
      />,
    )
    // The language comes from the design, so every slide built from it
    // agrees without anyone restating it per slide
    await waitFor(() =>
      expect(container.querySelector('pre')).toHaveAttribute(
        'data-language',
        'python',
      ),
    )
  })

  it('keeps indentation exactly as it was typed', () => {
    const source = 'def f():\n    if x:\n        return 1'
    render(
      <SlideSlot
        slot="example"
        spec={spec}
        slide={withCode(source)}
        colors={colors}
      />,
    )
    // A listing whose leading spaces were normalized is a different program
    expect(screen.getByRole('code').textContent).toBe(source)
  })

  it('edits as plain source, with spelling and autocorrect off', () => {
    render(
      <SlideSlot
        slot="example"
        spec={spec}
        slide={withCode('print(1)')}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Worked example'))
    const field = screen.getByLabelText('Worked example')
    // Autocorrect turns a quote into a curly quote and the program stops
    // running; a spelling underline calls a variable name a mistake
    expect(field).toHaveAttribute('spellcheck', 'false')
    expect(field).toHaveAttribute('autocorrect', 'off')
  })

  it('saves the source under the language the template declared', () => {
    vi.useFakeTimers()
    const onEdit = vi.fn()
    render(
      <SlideSlot
        slot="example"
        spec={spec}
        slide={withCode('print(1)')}
        colors={colors}
        onEdit={onEdit}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Worked example'))
    fireEvent.change(screen.getByLabelText('Worked example'), {
      target: { value: 'print(2)' },
    })
    vi.runAllTimers()
    expect(onEdit).toHaveBeenCalledWith({
      slots: {
        example: { kind: 'code', source: 'print(2)', language: 'python' },
      },
    })
    vi.useRealTimers()
  })
})

describe('an empty specialized box (EDIT-7)', () => {
  const emptySlide = (kind: 'code' | 'math' | 'preformatted') =>
    slide({
      slots: {
        box:
          kind === 'code'
            ? { kind: 'code', source: '' }
            : kind === 'math'
              ? { kind: 'math', tex: '' }
              : { kind: 'preformatted', value: '' },
      },
    })

  it.each([
    ['code' as const, 'Add code'],
    ['math' as const, 'Add a formula'],
    ['preformatted' as const, 'Add preformatted text'],
  ])(
    'names what belongs in it, not what the box is called (%s)',
    (kind, prompt) => {
      render(
        <SlideSlot
          slot="box"
          // Still labelled from the conventional slot it started as: what the
          // author needs to know is what it holds NOW
          spec={{ name: 'box', kind, label: 'Slide body' }}
          slide={emptySlide(kind)}
          colors={colors}
          onEdit={vi.fn()}
        />,
      )
      expect(screen.getByText(prompt)).toBeInTheDocument()
    },
  )

  it('names the language a code box declares', () => {
    render(
      <SlideSlot
        slot="box"
        spec={{
          name: 'box',
          kind: 'code',
          label: 'Slide body',
          options: { language: 'python' },
        }}
        slide={emptySlide('code')}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByText('Add python code')).toBeInTheDocument()
  })

  it('shows an audience nothing at all', () => {
    const { container } = render(
      <SlideSlot
        slot="box"
        spec={{ name: 'box', kind: 'math', label: 'Equation' }}
        slide={emptySlide('math')}
        colors={colors}
      />,
    )
    // The prompt is for whoever fills the box, not for the room
    expect(container.textContent).not.toContain('Add a formula')
  })
})

describe('a math slot (EDIT-7)', () => {
  const spec = { name: 'eq', kind: 'math' as const, label: 'Equation' }
  const withTex = (tex: string) =>
    slide({ slots: { eq: { kind: 'math', tex } } })

  it('hands the formula to the typesetter rather than printing it', async () => {
    render(
      <SlideSlot
        slot="eq"
        spec={spec}
        slide={withTex('E = mc^2')}
        colors={colors}
      />,
    )
    // An author writes what they know; the audience sees what they mean
    expect(await screen.findByTestId('typeset')).toHaveTextContent('E = mc^2')
  })

  it('reveals the LaTeX when you click to edit it', () => {
    render(
      <SlideSlot
        slot="eq"
        spec={spec}
        slide={withTex('E = mc^2')}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Equation'))
    expect(screen.getByLabelText('Equation')).toHaveValue('E = mc^2')
  })
})

describe('a preformatted slot (EDIT-7)', () => {
  const spec = {
    name: 'layout',
    kind: 'preformatted' as const,
    label: 'Diagram',
  }

  it('keeps the author’s exact spacing and line breaks', () => {
    const value = 'a   b\n  c'
    const { container } = render(
      <SlideSlot
        slot="layout"
        spec={spec}
        slide={slide({ slots: { layout: { kind: 'preformatted', value } } })}
        colors={colors}
      />,
    )
    // Read off the element rather than queried by text: the query normalizes
    // runs of spaces, which is the very thing this slot exists to keep
    expect(container.querySelector('pre')!.textContent).toBe(value)
  })
})

describe('a table slot (EDIT-7)', () => {
  const spec = { name: 'data', kind: 'table' as const, label: 'Data' }
  const table = slide({
    slots: {
      data: {
        kind: 'table',
        header: ['Year', 'Rainfall'],
        rows: [['2024', '812mm']],
      },
    },
  })

  it('shows a real table, with its header announced as one', () => {
    render(<SlideSlot slot="data" spec={spec} slide={table} colors={colors} />)
    // A screen reader announces the column a cell belongs to only if the
    // header is a header
    expect(screen.getByRole('columnheader', { name: 'Year' })).toBeVisible()
    expect(screen.getByRole('cell', { name: '812mm' })).toBeVisible()
  })

  it('edits one cell at a time', () => {
    vi.useFakeTimers()
    const onEdit = vi.fn()
    render(
      <SlideSlot
        slot="data"
        spec={spec}
        slide={table}
        colors={colors}
        onEdit={onEdit}
      />,
    )
    // Not one field holding a block of delimited text: an author fixing one
    // number should not have to keep the delimiters balanced
    fireEvent.click(screen.getByTitle('Click to edit Row 1, column 2'))
    fireEvent.change(screen.getByLabelText('Row 1, column 2'), {
      target: { value: '901mm' },
    })
    vi.runAllTimers()
    expect(onEdit).toHaveBeenCalledWith({
      slots: {
        data: {
          kind: 'table',
          header: ['Year', 'Rainfall'],
          rows: [['2024', '901mm']],
        },
      },
    })
    vi.useRealTimers()
  })

  it('makes the whole cell the click target, not just its words', () => {
    render(
      <SlideSlot
        slot="data"
        spec={spec}
        slide={table}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    // Aiming at the four characters already in a cell is not how anyone
    // edits a table
    expect(screen.getByTitle('Click to edit Row 1, column 1')).toHaveClass(
      'h-full',
      'w-full',
    )
  })

  it('shows an empty cell as somewhere to type', () => {
    render(
      <SlideSlot
        slot="data"
        spec={spec}
        slide={slide({
          slots: { data: { kind: 'table', header: ['Year'], rows: [['']] } },
        })}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    // The blank-slot placeholder text prose uses is invisible by design; a
    // table's empty cells are exactly where an author is about to type
    expect(
      screen.getByTitle('Click to edit Row 1, column 1'),
    ).toHaveTextContent('—')
  })

  it('drops a row when asked', () => {
    const onEdit = vi.fn()
    render(
      <SlideSlot
        slot="data"
        spec={spec}
        slide={slide({
          slots: {
            data: {
              kind: 'table',
              header: ['Year', 'Rainfall'],
              rows: [
                ['2024', '812mm'],
                ['2025', '640mm'],
              ],
            },
          },
        })}
        colors={colors}
        onEdit={onEdit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove row 1' }))
    expect(onEdit).toHaveBeenCalledWith({
      slots: {
        data: {
          kind: 'table',
          header: ['Year', 'Rainfall'],
          rows: [['2025', '640mm']],
        },
      },
    })
  })

  it('drops a column, header and all', () => {
    const onEdit = vi.fn()
    render(
      <SlideSlot
        slot="data"
        spec={spec}
        slide={table}
        colors={colors}
        onEdit={onEdit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove column 1' }))
    expect(onEdit).toHaveBeenCalledWith({
      slots: {
        data: { kind: 'table', header: ['Rainfall'], rows: [['812mm']] },
      },
    })
  })

  it('will not empty itself of rows or columns', () => {
    render(
      <SlideSlot
        slot="data"
        spec={spec}
        slide={slide({
          slots: { data: { kind: 'table', rows: [['only']] } },
        })}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    // A table with no rows or no columns is not a table; an author who wants
    // none of it empties the cells or drops the slide
    expect(screen.queryByRole('button', { name: /Remove row/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove column/ })).toBeNull()
  })

  it('grows by a row when asked', () => {
    const onEdit = vi.fn()
    render(
      <SlideSlot
        slot="data"
        spec={spec}
        slide={table}
        colors={colors}
        onEdit={onEdit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    expect(onEdit).toHaveBeenCalledWith({
      slots: {
        data: {
          kind: 'table',
          header: ['Year', 'Rainfall'],
          rows: [
            ['2024', '812mm'],
            ['', ''],
          ],
        },
      },
    })
  })

  describe('sizing its columns and rows (EDIT-7)', () => {
    /** The table, rendered for an owner who can edit it. */
    const editable = (
      onEdit: React.ComponentProps<typeof SlideSlot>['onEdit'],
      slide = table,
    ) => (
      <SlideSlot
        slot="data"
        spec={spec}
        slide={slide}
        colors={colors}
        onEdit={onEdit}
      />
    )

    /** The saved table from the last edit. */
    const saved = (onEdit: ReturnType<typeof vi.fn>) =>
      onEdit.mock.calls.at(-1)![0].slots.data

    it('offers a boundary to drag between two columns, and not past the last', () => {
      render(editable(vi.fn()))
      // Two columns, so one boundary inside the table. The table's right edge
      // is not a boundary — there is nothing on the other side of it to give
      // width back.
      expect(
        screen.getAllByRole('separator', { name: /Resize column/ }),
      ).toHaveLength(1)
    })

    it('offers one between the header and the row below it', () => {
      // The header is a band like any other; a table whose header is twice the
      // height of its rows is a table nobody chose.
      render(editable(vi.fn()))
      expect(
        screen.getAllByRole('separator', { name: /Resize row/ }),
      ).toHaveLength(1)
    })

    it('widens a column from the keyboard, since a drag is not available to everyone', () => {
      const onEdit = vi.fn()
      render(editable(onEdit))
      fireEvent.keyDown(
        screen.getByRole('separator', { name: 'Resize column 1' }),
        { key: 'ArrowRight' },
      )
      const value = saved(onEdit)
      expect(value.colWidths[0]).toBeGreaterThan(0.5)
      expect(value.colWidths[0] + value.colWidths[1]).toBeCloseTo(1)
    })

    it('narrows it again with the other arrow', () => {
      const onEdit = vi.fn()
      render(editable(onEdit))
      fireEvent.keyDown(
        screen.getByRole('separator', { name: 'Resize column 1' }),
        { key: 'ArrowLeft' },
      )
      expect(saved(onEdit).colWidths[0]).toBeLessThan(0.5)
    })

    it('takes only what its neighbour gives, so the rest of the table holds still', () => {
      const wide = slide({
        slots: {
          data: {
            kind: 'table',
            rows: [['a', 'b', 'c']],
            colWidths: [0.2, 0.3, 0.5],
          },
        },
      })
      const onEdit = vi.fn()
      render(editable(onEdit, wide))
      fireEvent.keyDown(
        screen.getByRole('separator', { name: 'Resize column 1' }),
        { key: 'ArrowRight' },
      )
      // The third column is not involved in the boundary that moved.
      expect(saved(onEdit).colWidths[2]).toBeCloseTo(0.5)
    })

    it('draws the table at the widths it carries', () => {
      const sized = slide({
        slots: {
          data: {
            kind: 'table',
            header: ['Year', 'Rainfall'],
            rows: [['2024', '812mm']],
            colWidths: [0.25, 0.75],
          },
        },
      })
      render(
        <SlideSlot slot="data" spec={spec} slide={sized} colors={colors} />,
      )
      const widths = [...document.querySelectorAll('col')].map(
        col => (col as HTMLElement).style.width,
      )
      expect(widths).toEqual(['25%', '75%'])
    })

    it('leaves a table nobody sized dividing itself equally', () => {
      // The common case and the old behaviour: no widths written, nothing to
      // migrate, and a table that looks as it always did.
      render(
        <SlideSlot slot="data" spec={spec} slide={table} colors={colors} />,
      )
      expect(document.querySelectorAll('col')).toHaveLength(0)
    })

    it('keeps the widths through an edit that is not about widths', () => {
      const sized = slide({
        slots: {
          data: {
            kind: 'table',
            rows: [['a', 'b']],
            colWidths: [0.3, 0.7],
          },
        },
      })
      const onEdit = vi.fn()
      render(editable(onEdit, sized))
      fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
      expect(saved(onEdit).colWidths).toEqual([0.3, 0.7])
    })

    it('widens a column by dragging its boundary', () => {
      // jsdom lays nothing out, so the table's width is stubbed: what is under
      // test is that a pointer drag becomes a fraction of the table, not the
      // browser's measuring.
      const onEdit = vi.fn()
      render(editable(onEdit))
      vi.spyOn(
        HTMLTableElement.prototype,
        'getBoundingClientRect',
      ).mockReturnValue({ width: 400, height: 200 } as DOMRect)
      const handle = screen.getByRole('separator', { name: 'Resize column 1' })
      handle.setPointerCapture = vi.fn()
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 240 })
      // Forty pixels of four hundred is a tenth of the table.
      expect(saved(onEdit).colWidths[0]).toBeCloseTo(0.6)
    })

    it('ignores a drag before the table has been measured', () => {
      // A hidden or still-laying-out table has no width, and a fraction of
      // nothing would resize the column by infinity.
      const onEdit = vi.fn()
      render(editable(onEdit))
      vi.spyOn(
        HTMLTableElement.prototype,
        'getBoundingClientRect',
      ).mockReturnValue({ width: 0, height: 0 } as DOMRect)
      const handle = screen.getByRole('separator', { name: 'Resize column 1' })
      handle.setPointerCapture = vi.fn()
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 200 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 240 })
      expect(onEdit).not.toHaveBeenCalled()
    })

    it('lets a removed column take its width with it', () => {
      // Otherwise the remaining columns are re-proportioned around the gap,
      // and deleting a column silently resizes the ones that stay.
      const sized = slide({
        slots: {
          data: {
            kind: 'table',
            rows: [['a', 'b', 'c']],
            colWidths: [0.2, 0.3, 0.5],
          },
        },
      })
      const onEdit = vi.fn()
      render(editable(onEdit, sized))
      fireEvent.click(screen.getByRole('button', { name: 'Remove column 1' }))
      expect(saved(onEdit).colWidths).toEqual([0.3, 0.5])
    })
  })
})

describe('what the template meant a box for (EDIT-7/TMPL-10)', () => {
  it('shows the instruction and limits to whoever is filling it', () => {
    render(
      <SlideSlot
        slot="example"
        spec={{
          name: 'example',
          kind: 'code',
          label: 'Worked example',
          description: 'A runnable Python snippet, no more than eight lines.',
          maxWords: 40,
        }}
        slide={slide({ slots: { example: { kind: 'code', source: 'x = 1' } } })}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    // Not on the slide itself: an audience does not want a line of
    // instructions under every box
    expect(screen.queryByText(/A runnable Python snippet/)).toBeNull()

    // An instructor typing into the box should see what it was for, rather
    // than having to guess from its name
    fireEvent.click(screen.getByTitle('Click to edit Worked example'))
    expect(screen.getByText(/A runnable Python snippet/)).toBeInTheDocument()
    expect(screen.getByText(/up to 40 words/)).toBeInTheDocument()
  })

  it('shows it on an ordinary text box too', () => {
    render(
      <SlideSlot
        slot="takeaway"
        spec={{
          name: 'takeaway',
          kind: 'text',
          label: 'Takeaway',
          description: 'One sentence a student should leave with.',
          maxWords: 12,
        }}
        slide={slide({
          slots: { takeaway: { kind: 'text', value: 'Rain is free.' } },
        })}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    // The requirement is about filling a slot by hand, not about which kind
    // it happens to be
    fireEvent.click(screen.getByTitle('Click to edit Takeaway'))
    expect(screen.getByText(/One sentence a student/)).toBeInTheDocument()
    expect(screen.getByText(/up to 12 words/)).toBeInTheDocument()
  })

  it('says nothing when the template said nothing', () => {
    render(
      <SlideSlot
        slot="note"
        spec={{ name: 'note', kind: 'text', label: 'Note' }}
        slide={slide({ slots: { note: { kind: 'text', value: 'Hi' } } })}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.queryByText(/up to/)).toBeNull()
  })

  it('shows it where a picture is actually chosen', async () => {
    render(
      <SlideSlot
        slot="figure"
        spec={{
          name: 'figure',
          kind: 'image',
          label: 'Figure',
          description: 'Only a photograph of the figure under discussion.',
        }}
        slide={slide({ slots: { figure: { kind: 'image' } } })}
        colors={colors}
        onEdit={vi.fn()}
        onReplaceImage={vi.fn()}
        onRemoveImage={vi.fn()}
        onPickImageCandidate={vi.fn()}
      />,
    )
    // An image box has no text field to hang a hint on, and choosing a
    // picture IS filling the slot by hand
    fireEvent.click(screen.getByRole('button', { name: 'Add image' }))
    expect(
      await screen.findByText(/Only a photograph of the figure/),
    ).toBeInTheDocument()
  })
})
