/**
 * Unit tests for restricted slide Markdown: inline emphasis, safe links,
 * lists in block mode only, no raw HTML, no heading takeover.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('renders links as inert styled text when links are off (edit mode)', () => {
    render(
      <SlideMarkdown
        text="[the docs](https://example.com)"
        inline
        links={false}
      />,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('the docs')).toBeInTheDocument()
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
