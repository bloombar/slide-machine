/**
 * Unit tests for a design's own page (TMPL-4) at `/t/:slug`.
 *
 * What belongs to the page rather than to the editor inside it: who it says
 * the design belongs to, that its author edits it and saves without leaving,
 * that anyone else sees it rather than edits it, that a design nobody may
 * read is refused the way a missing one is, and that leaving with unsaved
 * work asks first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Layout, LayoutNode, Template } from '@slide-machine/shared'
import TemplateEditorPage from './TemplateEditorPage'
import { dispatchAction } from '../api/actions'
import { ApiError } from '../api/http'

vi.mock('../api/actions')

const auth: { user: { id: string } | null; status: string } = {
  user: { id: 'u1' },
  status: 'authenticated',
}
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => auth,
}))

const tree = (children: LayoutNode[]): LayoutNode => ({
  id: 'root',
  container: { mode: 'flex', direction: 'column', gap: 3 },
  children,
})

const layout = (type: string, label: string, slots: string[]): Layout =>
  ({
    type,
    label,
    purpose: `use for ${type}`,
    slots: slots.map(name => ({ name, kind: 'text', label: name })),
    tree: tree(slots.map(name => ({ id: name, slot: name }))),
    elementPositions: {},
  }) as Layout

const template = (over: Partial<Template> = {}): Template => ({
  id: 'mine-1',
  permalinkSlug: 'my-style-ab12',
  ownerId: 'u1',
  owner: { id: 'u1', displayName: 'Ada' },
  name: 'My Style',
  theme: { background: '#ffffff', text: '#000000', accent: '#ff0000' },
  layouts: [
    layout('content', 'Content', ['title', 'body']),
    layout('whiteboard', 'Whiteboard', []),
  ],
  visibility: 'private',
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

/** Answers template.get with `loaded` and template.list with the library;
 * anything else (the preview images) resolves empty. */
const withTemplate = (loaded: Template | Error, library: Template[] = []) => {
  vi.mocked(dispatchAction).mockImplementation((action: string) => {
    if (action === 'template.get') {
      return loaded instanceof Error
        ? Promise.reject(loaded)
        : Promise.resolve(loaded)
    }
    if (action === 'template.list') return Promise.resolve(library)
    if (action === 'template.update') return Promise.resolve(loaded)
    return Promise.resolve({ urls: [] })
  })
}

const renderPage = () =>
  render(
    <MemoryRouter
      initialEntries={[
        { pathname: '/t/my-style-ab12', state: { from: '/d/lecture-1' } },
      ]}
    >
      <Routes>
        <Route path="/t/:slug" element={<TemplateEditorPage />} />
        <Route path="/d/:slug" element={<p>back at the lecture</p>} />
        <Route path="/app" element={<p>home</p>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.mocked(dispatchAction).mockReset()
  auth.user = { id: 'u1' }
  auth.status = 'authenticated'
})
afterEach(cleanup)

describe('TemplateEditorPage (TMPL-4)', () => {
  it('names the design and whose it is', async () => {
    withTemplate(template())
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'My Style', level: 1 }),
    ).toBeInTheDocument()
    // The byline reads through to the author's profile, as on a project page
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute(
      'href',
      '/u/u1',
    )
  })

  it('edits in place for its author', async () => {
    withTemplate(template())
    renderPage()

    expect(await screen.findByLabelText('Template name')).toHaveValue(
      'My Style',
    )
  })

  it('saves without leaving the page, and keeps saying whose design it is', async () => {
    // template.update answers with the template alone — the byline comes
    // from template.get, and must survive a save rather than blink out.
    const saved = template({ name: 'Renamed', owner: undefined })
    vi.mocked(dispatchAction).mockImplementation((action: string) => {
      if (action === 'template.get') return Promise.resolve(template())
      if (action === 'template.list') return Promise.resolve([])
      if (action === 'template.update') return Promise.resolve(saved)
      return Promise.resolve({ urls: [] })
    })
    renderPage()

    const name = await screen.findByLabelText('Template name')
    fireEvent.change(name, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Still here, with the editor open and the write acknowledged
    expect(await screen.findByTestId('template-saved')).toHaveTextContent(
      'Saved',
    )
    expect(screen.getByLabelText('Template name')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ada' })).toBeInTheDocument()
    expect(screen.queryByText('back at the lecture')).toBeNull()
  })

  it('shows a design belonging to someone else rather than editing it', async () => {
    withTemplate(
      template({
        ownerId: 'u2',
        owner: { id: 'u2', displayName: 'Bram' },
        visibility: 'public',
      }),
    )
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'My Style', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Template name')).toBeNull()
    // Every layout as a slide: that is what a design is
    expect(screen.getAllByTestId('template-preview').length).toBe(2)
  })

  it('refuses a design nobody may read the way it refuses a missing one', async () => {
    withTemplate(new ApiError(403, 'forbidden', 'Forbidden'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This design does not exist, or is private.',
    )
  })

  it('asks before leaving with unsaved work', async () => {
    withTemplate(template())
    renderPage()

    const name = await screen.findByLabelText('Template name')
    fireEvent.change(name, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    // Throwing the work away goes back to where the author came from
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(await screen.findByText('back at the lecture')).toBeInTheDocument()
  })

  it('leaves without asking when nothing is unsaved', async () => {
    withTemplate(template())
    renderPage()

    await screen.findByLabelText('Template name')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByText('back at the lecture')).toBeInTheDocument()
  })
})
