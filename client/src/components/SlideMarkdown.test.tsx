/**
 * Unit tests for restricted slide Markdown: inline emphasis, safe links,
 * lists in block mode only, no raw HTML, no heading takeover.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, createEvent } from '@testing-library/react'
import SlideMarkdown from './SlideMarkdown'

describe('SlideMarkdown', () => {
  it('renders inline emphasis and code', () => {
    render(<SlideMarkdown text="A **bold** and *subtle* `word`" inline />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('subtle').tagName).toBe('EM')
    expect(screen.getByText('word').tagName).toBe('CODE')
  })

  it('renders links safely with a new-tab target', () => {
    render(<SlideMarkdown text="See [the docs](https://example.com)" inline />)
    const link = screen.getByRole('link', { name: 'the docs' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  /**
   * In edit mode a plain click belongs to the editor, so the link is followed
   * on Cmd/Ctrl-click — the modifier a browser already uses to open a link,
   * and what most editors do for a link inside text you can edit.
   */
  describe('a link in text the reader can edit', () => {
    const editable = () =>
      render(
        <SlideMarkdown
          text="[the docs](https://example.com)"
          inline
          links={false}
        />,
      )

    it('is still a link: announced, addressed, openable from the menu', () => {
      editable()
      expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute(
        'href',
        'https://example.com',
      )
    })

    it('does not follow a plain click, which is the editor’s', () => {
      editable()
      const click = createEvent.click(screen.getByRole('link'), {
        bubbles: true,
      })
      fireEvent(screen.getByRole('link'), click)
      expect(click.defaultPrevented).toBe(true)
    })

    it('is drawn in the slide’s link colour, not the box’s', () => {
      // A box carries one colour and every run in it is drawn in that one, so
      // an imported deck whose links were red showed them in the body's
      // black. The colour rides on the slide as a custom property, since an
      // anchor is drawn deep inside any slot of any layout.
      editable()
      expect(screen.getByRole('link')).toHaveClass(
        'text-[color:var(--slide-link,inherit)]',
      )
    })

    it('says which key to hold, on the link itself', () => {
      // A tooltip alone tells only the reader who hovers and waits, and the
      // person who needs telling is the one who just clicked and saw nothing
      // happen. The badge is decoration for a screen reader, which announces
      // the anchor as a link already.
      editable()
      const link = screen.getByRole('link', { name: 'the docs' })
      expect(link.textContent).toMatch(/⌘|Ctrl/)
      expect(link.querySelector('sup')).toHaveAttribute('aria-hidden')
    })

    it('says it in the tooltip too, alongside where the link goes', () => {
      editable()
      expect(screen.getByRole('link')).toHaveAttribute(
        'title',
        expect.stringContaining('https://example.com'),
      )
      expect(screen.getByRole('link').getAttribute('title')).toMatch(
        /click to open|点击可打开/i,
      )
    })

    it('draws a presented link in that colour too', () => {
      render(<SlideMarkdown text="[the docs](https://example.com)" inline />)
      expect(screen.getByRole('link')).toHaveClass(
        'text-[color:var(--slide-link,inherit)]',
      )
    })

    it('leaves a link nobody is editing plain', () => {
      // The audience never sees the badge: on a slide being presented a plain
      // click follows the link, so there is nothing to explain.
      render(<SlideMarkdown text="[the docs](https://example.com)" inline />)
      expect(screen.getByRole('link').textContent).toBe('the docs')
    })

    it('follows a Cmd-click, and a Ctrl-click', () => {
      editable()
      for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
        const click = createEvent.click(screen.getByRole('link'), {
          bubbles: true,
          ...modifier,
        })
        fireEvent(screen.getByRole('link'), click)
        expect(click.defaultPrevented).toBe(false)
      }
    })
  })

  it('renders lists in block mode but not in inline slots', () => {
    const md = '- one\n- two'
    const { unmount } = render(<SlideMarkdown text={md} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    unmount()

    render(<SlideMarkdown text={md} inline />)
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.getByText(/one/)).toBeInTheDocument()
  })

  it('does not render raw HTML or heading syntax', () => {
    render(
      <SlideMarkdown text={'# Not a heading <script>x</script> <b>nope</b>'} />,
    )
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('b')).toBeNull()
    expect(screen.getByText(/Not a heading/)).toBeInTheDocument()
  })
})

describe('SlideMarkdown line breaks', () => {
  it('preserves single line breaks as <br>', () => {
    const { container } = render(<SlideMarkdown text={'line one\nline two'} />)
    expect(container.querySelector('br')).not.toBeNull()
    expect(screen.getByText(/line one/)).toBeInTheDocument()
    expect(screen.getByText(/line two/)).toBeInTheDocument()
  })

  it('renders blank-line separations as separate paragraphs', () => {
    const { container } = render(
      <SlideMarkdown text={'first para\n\nsecond para'} />,
    )
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })
})

/**
 * What an imported slide's points look like once written as Markdown
 * (`server/src/import/markdown.ts`): sub-points indented, numbered lists
 * numbered.
 */
describe('nested and numbered points', () => {
  it('draws a sub-point as a list inside a point', () => {
    render(<SlideMarkdown text={'- Steps\n  - First\n  - Second'} />)
    const lists = screen.getAllByRole('list')
    expect(lists.length).toBeGreaterThan(1)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('draws a numbered list as a numbered list', () => {
    const { container } = render(
      <SlideMarkdown
        text={'1. Form the question\n1. Scour the repositories'}
      />,
    )
    expect(container.querySelector('ol')).toBeInTheDocument()
    expect(container.querySelector('ul')).not.toBeInTheDocument()
  })

  it('renumbers in order, so a point added later still counts', () => {
    // Written as `1.` throughout, which is why the renderer must do the
    // counting rather than the text carrying it.
    const { container } = render(<SlideMarkdown text={'1. one\n1. two'} />)
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
  })
})

/**
 * How deep an ordered list is decides its marker (TMPL-8).
 *
 * Numbers, then letters, then roman numerals — the convention every document
 * editor uses, and what an imported slide shows: "1." with "a. b. c." beneath
 * it. Markdown has one ordered list and no way to say which marker it wants,
 * so the depth decides, which is how the original decided too.
 */
describe('a numbered list with a lettered one under it', () => {
  it('letters the level below the numbers', () => {
    render(
      <SlideMarkdown text={'1. Form the question\n   1. Who\n   1. What'} />,
    )
    const outer = document.querySelector('ol')!
    expect(outer.className).toContain('list-decimal')
    // The nested list is lettered by the same rule the outer one is numbered.
    expect(outer.className).toContain('[&_ol]:list-[lower-alpha]')
    expect(outer.querySelector('ol')).not.toBeNull()
  })
})
