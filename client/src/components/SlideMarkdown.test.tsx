/**
 * Unit tests for restricted slide Markdown: inline emphasis, safe links,
 * lists in block mode only, no raw HTML, no heading takeover.
 */
import { describe, it, expect, vi } from 'vitest'
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
   * A link is a link, in edit mode as much as in front of an audience: a
   * plain click on the words opens the page. The box around it is a
   * click-to-edit target, so the click stops at the anchor rather than
   * opening the editor as well.
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
      expect(screen.getByRole('link')).toHaveAttribute('target', '_blank')
    })

    it('follows a plain click, rather than leaving it to the editor', () => {
      editable()
      const click = createEvent.click(screen.getByRole('link'), {
        bubbles: true,
      })
      fireEvent(screen.getByRole('link'), click)
      expect(click.defaultPrevented).toBe(false)
    })

    it('keeps that click from also opening the box it sits in', () => {
      // The words around the link are a click-to-edit target listening on an
      // ancestor. A click meant for the link is not also a click meant for it.
      const onBoxClick = vi.fn()
      render(
        <span onClick={onBoxClick}>
          <SlideMarkdown
            text="See [the docs](https://example.com)"
            inline
            links={false}
          />
        </span>,
      )
      fireEvent.click(screen.getByRole('link'))
      expect(onBoxClick).not.toHaveBeenCalled()

      // ...while a click on the surrounding words still reaches it.
      fireEvent.click(screen.getByText(/See/))
      expect(onBoxClick).toHaveBeenCalled()
    })

    it('follows Enter on a focused link instead of opening the editor', () => {
      const onBoxKeyDown = vi.fn()
      render(
        <span onKeyDown={onBoxKeyDown}>
          <SlideMarkdown
            text="[the docs](https://example.com)"
            inline
            links={false}
          />
        </span>,
      )
      const enter = createEvent.keyDown(screen.getByRole('link'), {
        key: 'Enter',
        bubbles: true,
      })
      fireEvent(screen.getByRole('link'), enter)
      expect(onBoxKeyDown).not.toHaveBeenCalled()
      expect(enter.defaultPrevented).toBe(false)
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

    it('says in the tooltip that clicking opens it, and where it goes', () => {
      editable()
      expect(screen.getByRole('link')).toHaveAttribute(
        'title',
        expect.stringContaining('https://example.com'),
      )
      expect(screen.getByRole('link').getAttribute('title')).toMatch(
        /click to open/i,
      )
    })

    it('draws a presented link in that colour too', () => {
      render(<SlideMarkdown text="[the docs](https://example.com)" inline />)
      expect(screen.getByRole('link')).toHaveClass(
        'text-[color:var(--slide-link,inherit)]',
      )
    })

    it('carries no modifier-key badge in its text, in either mode', () => {
      // The link reads as the author wrote it: nothing is appended to say
      // which key to hold, because there is no longer a key to hold.
      editable()
      expect(screen.getByRole('link').textContent).toBe('the docs')
      expect(document.querySelector('sup')).toBeNull()
      expect(document.body.textContent).not.toMatch(/⌘|Ctrl/)
    })

    it('leaves a link nobody is editing plain, with no tooltip', () => {
      render(<SlideMarkdown text="[the docs](https://example.com)" inline />)
      expect(screen.getByRole('link').textContent).toBe('the docs')
      expect(screen.getByRole('link')).not.toHaveAttribute('title')
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
  it('reads a sub-point indented to its parent’s number as nested', () => {
    // The importer indents to the parent's CONTENT column, which is three for
    // "1. " and two for "- ". Indented by two, a numbered list's sub-points
    // came out level with their parents: 1, a, b, c, 2, 3 rendered as a flat
    // 1 to 6. Asserted here as well as in the importer, because the two have
    // to agree on the width and neither alone would catch a disagreement.
    render(
      <SlideMarkdown
        text={'1. Parent\n   1. Child\n   1. Child two\n1. Second'}
      />,
    )
    const top = document.querySelector('ol')!
    expect(top.querySelectorAll(':scope > li')).toHaveLength(2)
    expect(top.querySelectorAll(':scope > li > ol > li')).toHaveLength(2)
  })

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
