/**
 * Unit tests for the per-lecture admin view: lecture header with
 * visibility, project and owner links, the "View slideshow" button (which
 * confirms and logs before opening a private lecture), the detail rows,
 * the seed material, and the delete action. Settings are not edited here
 * — that moved into the lecture's own settings modal (ADMIN-5), covered
 * by DeckViewerPage's tests. Soft-deleted content is covered too: the
 * badge on the lecture and on withdrawn seed material, and the recovery
 * action (ADMIN-6).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import AdminDeckPage from './AdminDeckPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const detail = {
  deck: {
    id: 'd1',
    projectId: 'p1',
    title: 'Waves',
    permalinkSlug: 'waves-abc123',
    visibility: 'restricted',
    slideCount: 5,
    createdAt: '2026-07-02T00:00:00Z',
    updatedAt: '2026-07-03T00:00:00Z',
  },
  project: { id: 'p1', title: 'Physics' },
  owner: { id: 'u1', email: 'ada@example.com', displayName: 'Ada' },
  seed: { lecture: { assets: [] }, project: { assets: [] } },
}

/** Detail whose lecture and project both carry seed material. */
const seededDetail = {
  ...detail,
  seed: {
    lecture: {
      notes: 'Cover diffraction first',
      assets: [
        {
          id: 'a1',
          projectId: 'p1',
          deckId: 'd1',
          type: 'pdf',
          name: 'lecture-notes.pdf',
          status: 'ready',
          text: 'extracted lecture text',
          keywords: [],
          enabled: true,
          createdAt: '2026-07-02T00:00:00Z',
        },
      ],
    },
    project: {
      notes: 'Physics 101 syllabus',
      assets: [
        {
          id: 'a2',
          projectId: 'p1',
          type: 'image',
          name: 'diagram.png',
          status: 'ready',
          imageUrl: '/api/files/seed/xyz/diagram.png',
          keywords: [],
          enabled: true,
          createdAt: '2026-07-01T00:00:00Z',
        },
      ],
    },
  },
}

const renderPage = (status = 200, detailBody: unknown = detail) => {
  // Keys ordered most-specific first: the fetch mock matches by substring
  const mocks = mockFetchRoutes({
    // More specific than /decks/d1, so it must be matched first
    '/api/admin/decks/d1/private-view': () => ({ status: 204 }),
    // The telemetry panel's sessions (EVAL-1); empty keeps other tests quiet.
    '/api/admin/telemetry/decks/d1': () => ({
      status: 200,
      body: { sessions: [] },
    }),
    // Serves GET (detail) and DELETE (delete lecture)
    '/api/admin/decks/d1': init => {
      if (init?.method === 'DELETE') return { status: 204 }
      return { status, body: detailBody }
    },
  })
  render(
    <MemoryRouter initialEntries={['/app/admin/decks/d1']}>
      <Routes>
        <Route path="/app/admin/decks/:deckId" element={<AdminDeckPage />} />
        <Route
          path="/app/admin/projects/:projectId"
          element={<p>project page</p>}
        />
        <Route path="/d/:slug" element={<p>slideshow</p>} />
      </Routes>
    </MemoryRouter>,
  )
  return mocks
}

/** Detail for a public lecture, whose viewer opens without a confirm. */
const publicDetail = {
  ...detail,
  deck: { ...detail.deck, visibility: 'public' },
}

/** The method+url pairs fetched so far. */
const requested = (
  fetchMock: ReturnType<typeof mockFetchRoutes>['fetchMock'],
) =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminDeckPage', () => {
  it('shows the telemetry panel for the lecture (EVAL-1)', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Waves' })
    const panel = await screen.findByTestId('telemetry-panel')
    expect(
      within(panel).getByText('No live sessions recorded yet.'),
    ).toBeVisible()
  })

  it('shows the lecture title, its visibility, project, and owner', async () => {
    renderPage()
    const heading = await screen.findByRole('heading', { name: 'Waves' })
    expect(heading).toBeVisible()
    // Scoped to the header: the settings editor offers "Private" too
    expect(within(heading.closest('div')!).getByText('Private')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Physics' })).toHaveAttribute(
      'href',
      '/app/admin/projects/p1',
    )
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute(
      'href',
      '/app/admin/users/u1',
    )
    expect(screen.getByText(/ada@example\.com/)).toBeVisible()
  })

  it('shows the details, including the lecture id', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Waves' })
    const details = screen
      .getByRole('heading', { name: 'Details' })
      .closest('section')!
    expect(within(details).getByText('ID')).toBeVisible()
    expect(within(details).getByText('d1')).toBeVisible()
    expect(within(details).getByText('5')).toBeVisible()
    expect(within(details).getByText('/d/waves-abc123')).toBeVisible()
  })

  it('opens a public lecture straight away, with no confirm or view log', async () => {
    const { fetchMock } = renderPage(200, publicDetail)
    await screen.findByRole('heading', { name: 'Waves' })

    fireEvent.click(screen.getByRole('button', { name: 'View slideshow' }))

    // Public: navigates directly to the viewer, no dialog and no log
    expect(await screen.findByText('slideshow')).toBeVisible()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(requested(fetchMock)).not.toContainEqual(
      expect.stringMatching(/private-view/),
    )
  })

  it('confirms and logs before opening a private lecture', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Waves' })

    fireEvent.click(screen.getByRole('button', { name: 'View slideshow' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'View this private lecture?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'View slideshow' }),
    )

    // The access is logged, then the viewer opens
    expect(await screen.findByText('slideshow')).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/POST .*\/api\/admin\/decks\/d1\/private-view$/),
    )
  })

  it('does not log or navigate when the private-view confirm is cancelled', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Waves' })

    fireEvent.click(screen.getByRole('button', { name: 'View slideshow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText('slideshow')).not.toBeInTheDocument()
    expect(requested(fetchMock)).not.toContainEqual(
      expect.stringMatching(/private-view/),
    )
  })

  it("links back to the project's admin page", async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Waves' })
    expect(screen.getByRole('link', { name: '← Physics' })).toHaveAttribute(
      'href',
      '/app/admin/projects/p1',
    )
  })

  it('shows the detail rows', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Waves' })
    // Scoped to Details: the refine level pickers also offer a "5"
    const details = screen
      .getByRole('heading', { name: 'Details' })
      .closest('section')!
    expect(within(details).getByText('5')).toBeVisible()
    expect(within(details).getByText('/d/waves-abc123')).toBeVisible()
  })

  it('falls back to "Untitled lecture" for a blank title', async () => {
    renderPage(200, { ...detail, deck: { ...detail.deck, title: '  ' } })
    expect(
      await screen.findByRole('heading', { name: 'Untitled lecture' }),
    ).toBeVisible()
  })

  it("deletes the lecture after a confirm and returns to the project's page", async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Waves' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete lecture' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Delete this lecture?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete lecture' }),
    )

    expect(await screen.findByText('project page')).toBeVisible()
    expect(requested(fetchMock)).toContainEqual(
      expect.stringMatching(/DELETE .*\/api\/admin\/decks\/d1$/),
    )
  })

  it('does nothing when the confirm dialog is cancelled', async () => {
    const { fetchMock } = renderPage()
    await screen.findByRole('heading', { name: 'Waves' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete lecture' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(
      requested(fetchMock).filter(r => r.startsWith('DELETE')),
    ).toHaveLength(0)
  })

  it('marks seed material as None and hides the view button when there is none', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Waves' })
    expect(screen.getByText('None')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'View seed material' }),
    ).not.toBeInTheDocument()
  })

  it('marks seed material as Used and opens a grouped read-only view', async () => {
    renderPage(200, seededDetail)
    await screen.findByRole('heading', { name: 'Waves' })
    expect(screen.getByText('Used')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'View seed material' }))
    const dialog = screen.getByRole('dialog', { name: 'Seed material' })

    // Both levels are shown, grouped by lecture vs project.
    expect(within(dialog).getByText('This lecture')).toBeVisible()
    expect(within(dialog).getByText('From Physics')).toBeVisible()
    // Notes and files from each level appear.
    expect(within(dialog).getByText('Cover diffraction first')).toBeVisible()
    expect(within(dialog).getByText('lecture-notes.pdf')).toBeVisible()
    expect(within(dialog).getByText('Physics 101 syllabus')).toBeVisible()
    expect(within(dialog).getByText('diagram.png')).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(
      screen.queryByRole('dialog', { name: 'Seed material' }),
    ).not.toBeInTheDocument()
  })

  it('marks seed material Used when only the project supplies it', async () => {
    renderPage(200, {
      ...detail,
      seed: {
        lecture: { assets: [] },
        project: { notes: 'Project-wide notes', assets: [] },
      },
    })
    await screen.findByRole('heading', { name: 'Waves' })
    expect(screen.getByText('Used')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'View seed material' }))
    const dialog = screen.getByRole('dialog', { name: 'Seed material' })
    // The empty lecture level renders nothing; only the project group shows.
    expect(within(dialog).queryByText('This lecture')).not.toBeInTheDocument()
    expect(within(dialog).getByText('From Physics')).toBeVisible()
    expect(within(dialog).getByText('Project-wide notes')).toBeVisible()
  })

  it('shows an error state with a directory back link when the load fails', async () => {
    renderPage(500)
    expect(
      await screen.findByText('Could not load this lecture.'),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: '← All users' })).toHaveAttribute(
      'href',
      '/app/admin',
    )
  })
})

// ADMIN-6: a soft-deleted lecture is still openable here, badged, with
// recovery in place of the danger zone.
describe('AdminDeckPage soft-deleted content', () => {
  const deletedDetail = {
    ...detail,
    deck: { ...detail.deck, deletedAt: '2026-07-20T09:00:00Z' },
  }

  it('badges the lecture, keeps the viewer link, and offers a restore', async () => {
    renderPage(200, deletedDetail)
    await screen.findByRole('heading', { name: 'Waves' })

    expect(screen.getByText('Deleted')).toBeVisible()
    expect(screen.getByText(/This lecture is deleted/)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Restore lecture' }),
    ).toBeEnabled()
    // Still openable in the viewer (ADMIN-6), but nothing to delete again
    expect(screen.getByRole('button', { name: 'View slideshow' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Delete lecture' }),
    ).not.toBeInTheDocument()
  })

  it('confirms before opening a deleted lecture, and leaves the logging to the viewer', async () => {
    const { fetchMock } = renderPage(200, deletedDetail)
    await screen.findByRole('heading', { name: 'Waves' })

    fireEvent.click(screen.getByRole('button', { name: 'View slideshow' }))
    // The tombstone leads the copy, not the lecture's privacy
    const dialog = screen.getByRole('alertdialog', {
      name: 'View this deleted lecture?',
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'View slideshow' }),
    )

    expect(await screen.findByText('slideshow')).toBeVisible()
    // The viewer's own read writes the audit entry, so nothing is posted here
    expect(requested(fetchMock)).not.toContainEqual(
      expect.stringMatching(/private-view/),
    )
  })

  it('does not navigate when the deleted-view confirm is cancelled', async () => {
    renderPage(200, deletedDetail)
    await screen.findByRole('heading', { name: 'Waves' })

    fireEvent.click(screen.getByRole('button', { name: 'View slideshow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText('slideshow')).not.toBeInTheDocument()
  })

  it('restores the lecture after a confirm and reports it', async () => {
    const mocks = mockFetchRoutes({
      '/api/admin/decks/d1/restore': () => ({ status: 204 }),
      '/api/admin/decks/d1': () => ({ status: 200, body: deletedDetail }),
    })
    render(
      <MemoryRouter initialEntries={['/app/admin/decks/d1']}>
        <Routes>
          <Route path="/app/admin/decks/:deckId" element={<AdminDeckPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'Waves' })

    fireEvent.click(screen.getByRole('button', { name: 'Restore lecture' }))
    fireEvent.click(
      within(
        screen.getByRole('alertdialog', { name: 'Restore this lecture?' }),
      ).getByRole('button', { name: 'Restore lecture' }),
    )

    expect(await screen.findByText('Lecture restored.')).toBeVisible()
    expect(requested(mocks.fetchMock)).toContainEqual(
      expect.stringMatching(/POST .*\/api\/admin\/decks\/d1\/restore$/),
    )
  })

  it('badges seed material the owner removed', async () => {
    renderPage(200, {
      ...seededDetail,
      seed: {
        ...seededDetail.seed,
        lecture: {
          ...seededDetail.seed.lecture,
          assets: [
            {
              ...seededDetail.seed.lecture.assets[0]!,
              deletedAt: '2026-07-20T09:00:00Z',
            },
          ],
        },
      },
    })
    await screen.findByRole('heading', { name: 'Waves' })
    fireEvent.click(screen.getByRole('button', { name: 'View seed material' }))

    const dialog = screen.getByRole('dialog', { name: 'Seed material' })
    const row = within(dialog).getByText('lecture-notes.pdf').closest('li')!
    expect(within(row).getByText('Deleted')).toBeVisible()
    // The project's own asset is untouched, so it carries no badge.
    const liveRow = within(dialog).getByText('diagram.png').closest('li')!
    expect(within(liveRow).queryByText('Deleted')).not.toBeInTheDocument()
  })

  it('notes a project and owner deleted along with the lecture', async () => {
    renderPage(200, {
      ...deletedDetail,
      project: { ...detail.project, deletedAt: '2026-07-20T09:00:00Z' },
      owner: { ...detail.owner, deletedAt: '2026-07-20T09:00:00Z' },
    })
    await screen.findByRole('heading', { name: 'Waves' })
    expect(screen.getByText(/\(deleted\)/)).toBeVisible()
    expect(screen.getByText(/account deleted/)).toBeVisible()
  })
})
