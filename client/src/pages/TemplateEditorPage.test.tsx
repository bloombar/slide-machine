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
  visibility: 'restricted',
  myRole: 'owner',
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

/** Answers template.get with `loaded` and template.list with the library;
 * template.shares (the owner's sharing panel, TMPL-26) with an empty people
 * list; anything else (the preview images) resolves empty. */
const withTemplate = (loaded: Template | Error, library: Template[] = []) => {
  vi.mocked(dispatchAction).mockImplementation((action: string) => {
    if (action === 'template.get') {
      return loaded instanceof Error
        ? Promise.reject(loaded)
        : Promise.resolve(loaded)
    }
    if (action === 'template.list') return Promise.resolve(library)
    if (action === 'template.update') return Promise.resolve(loaded)
    if (action === 'template.shares') return Promise.resolve([])
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
      if (action === 'template.shares') return Promise.resolve([])
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
        myRole: null,
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

  // TMPL-26: an editor gets the same editor its author does — template.update
  // already accepts either, and the page's own gate is widened to match.
  it('edits in place for someone shared with as an editor', async () => {
    withTemplate(
      template({
        ownerId: 'u2',
        owner: { id: 'u2', displayName: 'Bram' },
        visibility: 'restricted',
        myRole: 'editor',
      }),
    )
    renderPage()

    expect(await screen.findByLabelText('Template name')).toHaveValue(
      'My Style',
    )
  })

  // A viewer gets the read-only view, same as a stranger would.
  it('shows the reader view for someone shared with as a viewer', async () => {
    withTemplate(
      template({
        ownerId: 'u2',
        owner: { id: 'u2', displayName: 'Bram' },
        visibility: 'restricted',
        myRole: 'viewer',
      }),
    )
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'My Style', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Template name')).toBeNull()
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

  // TMPL-26: changing general access is a save of its own (`template.setAccess`),
  // separate from the content draft `template.update` saves — it must not
  // silently discard whatever unsaved rename or edit the author is mid-way
  // through, which the naive "adopt whatever the server just handed back"
  // read of its result would do.
  it('keeps an unsaved rename after changing general access', async () => {
    const loaded = template()
    vi.mocked(dispatchAction).mockImplementation((action: string) => {
      if (action === 'template.get') return Promise.resolve(loaded)
      if (action === 'template.list') return Promise.resolve([])
      if (action === 'template.shares') return Promise.resolve([])
      if (action === 'template.setAccess') {
        return Promise.resolve({ ...loaded, visibility: 'public' })
      }
      return Promise.resolve({ urls: [] })
    })
    renderPage()

    const name = await screen.findByLabelText('Template name')
    fireEvent.change(name, { target: { value: 'Renamed' } })

    fireEvent.click(await screen.findByRole('radio', { name: /public/i }))
    await vi.waitFor(() =>
      expect(screen.getByRole('radio', { name: /public/i })).toBeChecked(),
    )

    // Still there, unsaved
    expect(screen.getByLabelText('Template name')).toHaveValue('Renamed')
    // Still counts as unsaved work
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })

  // TMPL-26 round 2: the editor's own form and the owner's sharing panel's
  // "Add people" form are now siblings, not one nested inside the other —
  // the nesting broke the "Add" button outright (a click submitted both
  // forms, natively). Enter in the name field must still reach `save`,
  // through this form alone.
  it('saves on Enter in the name field', async () => {
    const loaded = template()
    vi.mocked(dispatchAction).mockImplementation((action: string) => {
      if (action === 'template.get') return Promise.resolve(loaded)
      if (action === 'template.list') return Promise.resolve([])
      if (action === 'template.shares') return Promise.resolve([])
      if (action === 'template.update')
        return Promise.resolve({ ...loaded, name: 'Renamed' })
      return Promise.resolve({ urls: [] })
    })
    renderPage()

    const name = await screen.findByLabelText('Template name')
    fireEvent.change(name, { target: { value: 'Renamed' } })
    // jsdom does not wire a text field's Enter key to its form's implicit
    // submission (a documented jsdom gap), so the 'submit' event this
    // editor's own onSubmit handles is raised directly — exactly what a
    // real Enter keypress in this field would raise.
    fireEvent.submit(name.closest('form')!)

    await screen.findByTestId('template-saved')
    expect(dispatchAction).toHaveBeenCalledWith(
      'template.update',
      expect.objectContaining({ name: 'Renamed' }),
    )
    expect(dispatchAction).not.toHaveBeenCalledWith(
      'template.share',
      expect.anything(),
    )
  })

  // The mirror case: adding a person calls `template.share` alone, whether
  // triggered by Enter in the email field or by clicking Add — never the
  // editor's own save, since the two forms no longer share any DOM nesting
  // that could let one submission reach the other's handler.
  it('adding a person calls template.share alone, by Enter or by clicking Add', async () => {
    const loaded = template()
    vi.mocked(dispatchAction).mockImplementation((action: string) => {
      if (action === 'template.get') return Promise.resolve(loaded)
      if (action === 'template.list') return Promise.resolve([])
      if (action === 'template.shares') return Promise.resolve([])
      if (action === 'template.share') return Promise.resolve([])
      return Promise.resolve({ urls: [] })
    })
    renderPage()

    const email = await screen.findByLabelText('Add people by email')
    fireEvent.change(email, { target: { value: 'byron@example.com' } })
    fireEvent.submit(email.closest('form')!)
    await vi.waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith(
        'template.share',
        expect.objectContaining({ email: 'byron@example.com' }),
      ),
    )
    expect(dispatchAction).not.toHaveBeenCalledWith(
      'template.update',
      expect.anything(),
    )

    vi.mocked(dispatchAction).mockClear()
    fireEvent.change(email, { target: { value: 'clara@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await vi.waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith(
        'template.share',
        expect.objectContaining({ email: 'clara@example.com' }),
      ),
    )
    expect(dispatchAction).not.toHaveBeenCalledWith(
      'template.update',
      expect.anything(),
    )
  })

  it('leaves without asking when nothing is unsaved', async () => {
    withTemplate(template())
    renderPage()

    await screen.findByLabelText('Template name')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByText('back at the lecture')).toBeInTheDocument()
  })
})
